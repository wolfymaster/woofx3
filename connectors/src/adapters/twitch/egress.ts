import {
  type ChatDeletePayload,
  type ChatPinPayload,
  type ChatSendPayload,
  type FailureCode,
  isTwitchAnnouncementColor,
  type ModerationBanPayload,
  type ModerationTimeoutPayload,
  type ModerationWarnPayload,
  type PlatformOutcome,
  TWITCH_ANNOUNCEMENT_COLORS,
  type TwitchAnnouncementColor,
  type UnavailableReason,
} from "@woofx3/api/platform-gateway";
import type { HelixCommandArgs, HelixCommandResult } from "@woofx3/common/cloudevents/Twitch/commands";
import type { EgressContext, EgressHandlerSpec, EgressHandlers } from "../../host/adapter";
import { type Clock, errorMessage } from "../../host/deps";
import { type ParseResult, parsed, parseFailed } from "../../host/host-requests";
import { HELIX_DEADLINE_MS, HelixNoAnswer, readSentChatMessage } from "./lib/helix";
import type { SendQueue } from "./lib/send-queue";
import { TIMEOUT_MAX_SECONDS, TIMEOUT_REASON_MAX_LENGTH, type TwitchApiCall } from "./lib/twitch";
import { TwitchApiError } from "./lib/twitchApiError";

/** Used when a `chat.announce` request carries no Twitch options: the channel's accent colour. */
export const DEFAULT_ANNOUNCEMENT_COLOR: TwitchAnnouncementColor = "primary";

/** `options.twitch` on a `chat.announce` request. */
export interface AnnounceOptions {
  color: TwitchAnnouncementColor;
}

/**
 * Time held back from the request's deadline when pinning a line just posted.
 * The pin gives up this much early so the handler can still answer, with the
 * posted line's `messageId`, before the gateway answers for it without one.
 */
const PIN_REPLY_MARGIN_MS = 250;

/**
 * The failure code for each Helix error status a chat write can get. Any
 * other status is `upstream`: Twitch failed, and the request may be fine.
 */
const HELIX_STATUS_FAILURES: Readonly<Partial<Record<number, FailureCode>>> = {
  400: "invalid",
  422: "invalid",
  401: "forbidden",
  403: "forbidden",
  429: "rate_limited",
};

export function helixFailureCode(status: number): FailureCode {
  return HELIX_STATUS_FAILURES[status] ?? "upstream";
}

/** Twitch's Warn Chat User refuses a reason longer than this. */
export const TWITCH_WARN_REASON_MAX_LENGTH = 500;

/**
 * Delete Chat Messages answers 404 for a message that is gone or older than
 * 6 hours, and 400 for one Twitch will not delete (the broadcaster's or
 * another moderator's). Neither is Twitch failing: the line is not deletable.
 */
const DELETE_STATUS_FAILURES: Readonly<Partial<Record<number, FailureCode>>> = { 404: "invalid" };

/**
 * Warn Chat User answers 409 when another update to the viewer's warning
 * state raced it. Worth exactly one more attempt; a second 409 is upstream.
 */
const WARN_CONFLICT_STATUS = 409;

/**
 * Where egress sends its Helix calls: the running adapter's Twitch client,
 * or why there is none. Read when a write's turn comes, not when it is
 * queued, so a write never goes out on a connection that has since closed.
 */
export type TwitchEgressSession =
  | {
      kind: "ready";
      /** The linked broadcaster's user id, whom no moderation action may target. */
      broadcasterId: string;
      helix(args: HelixCommandArgs, call: TwitchApiCall): Promise<HelixCommandResult>;
    }
  | { kind: "unavailable"; reason: Extract<UnavailableReason, "stopped" | "starting"> };

export interface TwitchEgressDeps {
  session(): TwitchEgressSession;
  /** Shared by every action, so all platform gateway chat writes reach Twitch in order. */
  queue: SendQueue;
  clock: Clock;
}

/**
 * The Twitch adapter's platform gateway actions: one handler per action id.
 * Every write waits its turn in the send queue and makes one Helix attempt;
 * the outcome says what Twitch did with it, and a write that may have reached
 * Twitch is never reported as one that did not.
 */
export function twitchEgress(deps: TwitchEgressDeps): EgressHandlers {
  return {
    "chat.send": {
      handle: (payload, _options, ctx) => queued(deps, ctx, () => sendLine(deps, ctx, payload)),
    },
    "chat.announce": announce(deps),
    "chat.pin": {
      handle: (payload, _options, ctx) => queued(deps, ctx, () => pin(deps, ctx, payload)),
    },
    "chat.delete": {
      handle: (payload, _options, ctx) => queued(deps, ctx, () => deleteMessage(deps, ctx, payload)),
    },
    "moderation.warn": {
      handle: (payload, _options, ctx) => queued(deps, ctx, () => warn(deps, ctx, payload)),
    },
    "moderation.timeout": {
      handle: (payload, _options, ctx) => queued(deps, ctx, () => ban(deps, ctx, payload)),
    },
    "moderation.ban": {
      handle: (payload, _options, ctx) => queued(deps, ctx, () => ban(deps, ctx, payload)),
    },
  };
}

async function deleteMessage(
  deps: TwitchEgressDeps,
  ctx: EgressContext,
  payload: ChatDeletePayload
): Promise<PlatformOutcome> {
  if (payload.messageId.trim() === "") {
    return refusedHere("a delete needs the message id; without one Twitch clears the whole chat");
  }
  const attempt = await attemptHelix(
    deps,
    ctx,
    { operation: "deleteChatMessage", params: { message_id: payload.messageId } },
    DELETE_STATUS_FAILURES
  );
  return attempt.kind === "answered" ? { status: "delivered" } : attempt.outcome;
}

/** Twitch's own warning, which the viewer must acknowledge before chatting again. A 409 is tried once more. */
async function warn(
  deps: TwitchEgressDeps,
  ctx: EgressContext,
  payload: ModerationWarnPayload
): Promise<PlatformOutcome> {
  if ([...payload.reason].length > TWITCH_WARN_REASON_MAX_LENGTH) {
    return refusedHere(`a warning reason is at most ${TWITCH_WARN_REASON_MAX_LENGTH} characters on Twitch`);
  }
  const args: HelixCommandArgs = {
    operation: "warnChatUser",
    params: { user_id: payload.viewer, reason: payload.reason },
  };
  return moderate(deps, payload.viewer, async () => {
    const first = await attemptHelix(deps, ctx, args);
    const conflicted = first.kind === "ended" && first.status === WARN_CONFLICT_STATUS;
    const attempt = conflicted ? await attemptHelix(deps, ctx, args) : first;
    return attempt.kind === "answered" ? { status: "delivered" } : attempt.outcome;
  });
}

/** Ban User: a timeout when the payload carries a duration, else a ban. */
async function ban(
  deps: TwitchEgressDeps,
  ctx: EgressContext,
  payload: ModerationTimeoutPayload | ModerationBanPayload
): Promise<PlatformOutcome> {
  const params: Record<string, unknown> = { user_id: payload.viewer };
  if ("durationSeconds" in payload) {
    if (payload.durationSeconds < 1 || payload.durationSeconds > TIMEOUT_MAX_SECONDS) {
      return refusedHere(`a timeout is 1 to ${TIMEOUT_MAX_SECONDS} seconds on Twitch`);
    }
    params.duration = payload.durationSeconds;
  }
  if (payload.reason !== undefined) {
    if ([...payload.reason].length > TIMEOUT_REASON_MAX_LENGTH) {
      return refusedHere(`a ban or timeout reason is at most ${TIMEOUT_REASON_MAX_LENGTH} characters on Twitch`);
    }
    params.reason = payload.reason;
  }
  return moderate(deps, payload.viewer, () => write(deps, ctx, { operation: "banUser", params }));
}

/**
 * Runs a moderation write against `viewer`, unless the viewer is the
 * broadcaster, whose own token performs it: Twitch refuses that anyway, and
 * no rule may punish the channel's owner.
 */
async function moderate(
  deps: TwitchEgressDeps,
  viewer: string,
  act: () => Promise<PlatformOutcome>
): Promise<PlatformOutcome> {
  const session = deps.session();
  if (session.kind === "ready" && session.broadcasterId === viewer) {
    return refusedHere("the broadcaster cannot be warned, timed out or banned");
  }
  return act();
}

function refusedHere(message: string): PlatformOutcome {
  return { status: "failed", code: "invalid", message };
}

function announce(deps: TwitchEgressDeps): EgressHandlerSpec<"chat.announce", AnnounceOptions> {
  return {
    parseOptions: parseAnnounceOptions,
    handle: (payload, options, ctx) =>
      queued(deps, ctx, () =>
        write(deps, ctx, {
          operation: "sendChatAnnouncement",
          params: { message: payload.message, color: (options ?? defaultAnnounceOptions()).color },
        })
      ),
  };
}

function defaultAnnounceOptions(): AnnounceOptions {
  return { color: DEFAULT_ANNOUNCEMENT_COLOR };
}

/** `{ color? }`, nothing else. An absent colour is the default. */
export function parseAnnounceOptions(raw: unknown): ParseResult<AnnounceOptions> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return parseFailed("must be an object");
  }
  const unknownKey = Object.keys(raw).find((key) => key !== "color");
  if (unknownKey !== undefined) {
    return parseFailed(`unknown option "${unknownKey}"`);
  }
  const color: unknown = (raw as { color?: unknown }).color;
  if (color === undefined) {
    return parsed(defaultAnnounceOptions());
  }
  if (!isTwitchAnnouncementColor(color)) {
    return parseFailed(`color must be one of ${TWITCH_ANNOUNCEMENT_COLORS.join(", ")}`);
  }
  return parsed({ color });
}

/** Runs `job` in its turn in the send queue, or says why it never ran. */
async function queued(
  deps: TwitchEgressDeps,
  ctx: EgressContext,
  job: () => Promise<PlatformOutcome>
): Promise<PlatformOutcome> {
  const run = await deps.queue.run(job, ctx.signal);
  switch (run.kind) {
    case "ran": {
      return run.value;
    }
    case "full": {
      return {
        status: "failed",
        code: "rate_limited",
        message: "too many Twitch chat writes are waiting; try again shortly",
      };
    }
    case "abandoned": {
      return notSent();
    }
  }
}

async function sendLine(
  deps: TwitchEgressDeps,
  ctx: EgressContext,
  payload: ChatSendPayload
): Promise<PlatformOutcome> {
  const params: Record<string, unknown> = { message: payload.message };
  if (payload.replyToMessageId !== undefined) {
    params.reply_parent_message_id = payload.replyToMessageId;
  }
  const attempt = await attemptHelix(deps, ctx, { operation: "sendChatMessage", params });
  if (attempt.kind !== "answered") {
    return attempt.outcome;
  }
  const sent = readSentChatMessage(attempt.body);
  if (sent === null) {
    return { status: "unconfirmed", message: "Twitch accepted the line but its answer could not be read" };
  }
  if (!sent.sent) {
    return { status: "dropped", reason: sent.dropReason };
  }
  return { status: "delivered", messageId: sent.messageId };
}

/**
 * Pins an existing line, or posts a new one and pins it. A line posted but
 * not pinned is a failure that still carries its `messageId`, so a caller
 * can pin it again rather than post it twice.
 */
async function pin(deps: TwitchEgressDeps, ctx: EgressContext, payload: ChatPinPayload): Promise<PlatformOutcome> {
  if ("messageId" in payload) {
    return pinById(deps, ctx, payload.messageId, undefined);
  }
  const posted = await sendLine(deps, ctx, { message: payload.message });
  if (posted.status !== "delivered" || posted.messageId === undefined) {
    return posted;
  }
  const pinCtx = { ...ctx, deadline: ctx.deadline - PIN_REPLY_MARGIN_MS };
  const pinned =
    pinCtx.deadline > deps.clock.now()
      ? await pinById(deps, pinCtx, posted.messageId, payload.durationSeconds)
      : notSent();
  if (pinned.status === "delivered") {
    return pinned;
  }
  return {
    status: "failed",
    code: pinned.status === "failed" ? pinned.code : "upstream",
    message: `posted but not pinned: ${outcomeInWords(pinned)}`,
    messageId: posted.messageId,
  };
}

async function pinById(
  deps: TwitchEgressDeps,
  ctx: EgressContext,
  messageId: string,
  durationSeconds: number | undefined
): Promise<PlatformOutcome> {
  const params: Record<string, unknown> = { message_id: messageId };
  if (durationSeconds !== undefined) {
    params.duration = durationSeconds;
  }
  const outcome = await write(deps, ctx, { operation: "pinChatMessage", params });
  return outcome.status === "delivered" ? { status: "delivered", messageId } : outcome;
}

/** A write whose 2xx answer means Twitch did it, such as an announcement's 204. */
async function write(deps: TwitchEgressDeps, ctx: EgressContext, args: HelixCommandArgs): Promise<PlatformOutcome> {
  const attempt = await attemptHelix(deps, ctx, args);
  return attempt.kind === "answered" ? { status: "delivered" } : attempt.outcome;
}

/**
 * A Helix call that Twitch answered with a 2xx, or the outcome it ended with
 * instead, with Twitch's status when it answered one.
 */
type HelixAttempt = { kind: "answered"; body: unknown } | { kind: "ended"; outcome: PlatformOutcome; status?: number };

/**
 * One Helix call as the broadcaster, bounded by the request's deadline and
 * HELIX_DEADLINE_MS, whichever is first. Marks the request sent just before
 * it leaves, so the gateway reports a deadline after that as unconfirmed, and
 * hands on the request's workflow chain, which a chat line's echo carries.
 */
async function attemptHelix(
  deps: TwitchEgressDeps,
  ctx: EgressContext,
  args: HelixCommandArgs,
  statusFailures: Readonly<Partial<Record<number, FailureCode>>> = {}
): Promise<HelixAttempt> {
  const session = deps.session();
  if (session.kind === "unavailable") {
    return { kind: "ended", outcome: { status: "unavailable", reason: session.reason } };
  }
  const call: TwitchApiCall = {
    helixDeadlineMs: Math.max(0, Math.min(HELIX_DEADLINE_MS, ctx.deadline - deps.clock.now())),
    signal: ctx.signal,
    onSent: () => ctx.markSent(),
    workflowChain: ctx.workflowChain,
  };
  let result: HelixCommandResult;
  try {
    result = await session.helix(args, call);
  } catch (err) {
    return { kind: "ended", outcome: thrownOutcome(err) };
  }
  if (!result.ok) {
    const code = statusFailures[result.status] ?? helixFailureCode(result.status);
    return {
      kind: "ended",
      status: result.status,
      outcome: { status: "failed", code, message: helixErrorMessage(result) },
    };
  }
  return { kind: "answered", body: result.body };
}

function thrownOutcome(err: unknown): PlatformOutcome {
  if (err instanceof HelixNoAnswer) {
    return err.sent ? { status: "unconfirmed", message: err.message } : notSent();
  }
  if (err instanceof TwitchApiError && err.code === "invalid_arguments") {
    return { status: "failed", code: "invalid", message: err.message };
  }
  return { status: "failed", code: "upstream", message: errorMessage(err) };
}

function notSent(): PlatformOutcome {
  return { status: "failed", code: "upstream", message: "did not reach Twitch before the deadline" };
}

/** Twitch's own reason from an error body (`{ error, status, message }`), else its status. */
function helixErrorMessage(result: Extract<HelixCommandResult, { ok: false }>): string {
  try {
    const body = JSON.parse(result.body) as { message?: unknown } | null;
    if (typeof body?.message === "string" && body.message !== "") {
      return `Twitch answered ${result.status}: ${body.message}`;
    }
  } catch {
    // Not JSON: Twitch's status alone says what happened.
  }
  return `Twitch answered ${result.status}`;
}

/** An outcome that is not `delivered`, in words, for a partial failure's message. */
function outcomeInWords(outcome: Exclude<PlatformOutcome, { status: "delivered" }>): string {
  switch (outcome.status) {
    case "failed":
    case "unconfirmed": {
      return outcome.message;
    }
    case "dropped": {
      return outcome.reason;
    }
    case "unavailable": {
      return `Twitch is unavailable (${outcome.reason})`;
    }
    case "unsupported": {
      return "unsupported";
    }
  }
}
