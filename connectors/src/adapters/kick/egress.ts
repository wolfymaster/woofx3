import type {
  ChatDeletePayload,
  ChatSendPayload,
  FailureCode,
  ModerationBanPayload,
  ModerationTimeoutPayload,
  PlatformOutcome,
  UnavailableReason,
} from "@woofx3/api/platform-gateway";
import type { EgressContext, EgressHandlers } from "../../host/adapter";
import type { SelfSentRecorder } from "../shared/self-sent";
import type { SendQueue } from "../shared/send-queue";
import type { KickApi, KickApiFailure, KickResult } from "./lib/kick-api";
import { kickBan } from "./lib/moderation";

/** Kick refuses a chat message above this many UTF-8 bytes (its 500-character cap is the gateway contract's). */
export const KICK_CHAT_MAX_BYTES = 2048;

/** The failure code for each Kick error status. Any other status is `upstream`. */
const STATUS_FAILURES: Readonly<Partial<Record<number, FailureCode>>> = {
  400: "invalid",
  422: "invalid",
  401: "forbidden",
  403: "forbidden",
  429: "rate_limited",
};

/** Kick answers 404 for a chat message that is gone: it is not deletable, not Kick failing. */
const DELETE_STATUS_FAILURES: Readonly<Partial<Record<number, FailureCode>>> = { 404: "invalid" };

/**
 * The running adapter's Kick client and broadcaster, or why there is none.
 * Read when a write's turn comes, so a write never goes out on a run that
 * has since stopped.
 */
export type KickEgressSession =
  | {
      kind: "ready";
      broadcasterUserId: string;
      api: Pick<KickApi, "sendChat" | "deleteChat" | "ban">;
    }
  | { kind: "unavailable"; reason: Extract<UnavailableReason, "stopped" | "starting"> };

export interface KickEgressDeps {
  session(): KickEgressSession;
  /** Shared by every action, so the gateway's writes reach Kick in order. */
  queue: SendQueue;
  /** The engine's own lines, so their webhook echo publishes as the engine's. */
  selfSent: SelfSentRecorder;
}

/**
 * The Kick adapter's platform gateway actions. Kick has no announcement,
 * pin or warning, so those actions have no handler and the gateway answers
 * them `unsupported`. Every write waits its turn in the send queue and makes
 * one attempt.
 */
export function kickEgress(deps: KickEgressDeps): EgressHandlers {
  return {
    "chat.send": { handle: (payload, _options, ctx) => queued(deps, ctx, () => sendLine(deps, ctx, payload)) },
    "chat.delete": { handle: (payload, _options, ctx) => queued(deps, ctx, () => deleteLine(deps, ctx, payload)) },
    "moderation.timeout": { handle: (payload, _options, ctx) => queued(deps, ctx, () => ban(deps, ctx, payload)) },
    "moderation.ban": { handle: (payload, _options, ctx) => queued(deps, ctx, () => ban(deps, ctx, payload)) },
  };
}

async function sendLine(deps: KickEgressDeps, ctx: EgressContext, payload: ChatSendPayload): Promise<PlatformOutcome> {
  if (new TextEncoder().encode(payload.message).length > KICK_CHAT_MAX_BYTES) {
    return refusedHere(`a chat message is at most ${KICK_CHAT_MAX_BYTES} bytes on Kick`);
  }
  const session = deps.session();
  if (session.kind === "unavailable") {
    return { status: "unavailable", reason: session.reason };
  }
  const line = deps.selfSent.begin(payload.message, ctx.workflowChain);
  ctx.markSent();
  const sent = await session.api.sendChat({
    content: payload.message,
    broadcasterUserId: session.broadcasterUserId,
    ...(payload.replyToMessageId === undefined ? {} : { replyTo: payload.replyToMessageId }),
  });
  if (!sent.ok) {
    line.failed();
    return failedOutcome(sent.error, STATUS_FAILURES);
  }
  if (!sent.value.sent) {
    line.failed();
    return { status: "dropped", reason: "Kick did not post the line" };
  }
  line.sent(sent.value.messageId);
  return { status: "delivered", messageId: sent.value.messageId };
}

async function deleteLine(
  deps: KickEgressDeps,
  ctx: EgressContext,
  payload: ChatDeletePayload
): Promise<PlatformOutcome> {
  if (payload.messageId.trim() === "") {
    return refusedHere("a delete needs the message id");
  }
  return write(deps, ctx, (session) => session.api.deleteChat(payload.messageId), DELETE_STATUS_FAILURES);
}

/** A timeout when the payload carries a duration, rounded up to whole minutes, else a ban. */
async function ban(
  deps: KickEgressDeps,
  ctx: EgressContext,
  payload: ModerationTimeoutPayload | ModerationBanPayload
): Promise<PlatformOutcome> {
  if (!/^\d+$/.test(payload.viewer)) {
    return refusedHere("a Kick viewer is named by their numeric user id");
  }
  const checked = kickBan("durationSeconds" in payload ? payload.durationSeconds : undefined, payload.reason);
  if (!checked.ok) {
    return refusedHere(checked.error);
  }
  const { durationMinutes } = checked;
  const session = deps.session();
  if (session.kind === "ready" && session.broadcasterUserId === payload.viewer) {
    return refusedHere("the broadcaster cannot be timed out or banned");
  }
  return write(deps, ctx, (ready) =>
    ready.api.ban({
      broadcasterUserId: ready.broadcasterUserId,
      userId: payload.viewer,
      ...(durationMinutes === undefined ? {} : { durationMinutes }),
      ...(payload.reason === undefined ? {} : { reason: payload.reason }),
    })
  );
}

async function write(
  deps: KickEgressDeps,
  ctx: EgressContext,
  call: (session: Extract<KickEgressSession, { kind: "ready" }>) => Promise<KickResult<null>>,
  statusFailures: Readonly<Partial<Record<number, FailureCode>>> = {}
): Promise<PlatformOutcome> {
  const session = deps.session();
  if (session.kind === "unavailable") {
    return { status: "unavailable", reason: session.reason };
  }
  ctx.markSent();
  const result = await call(session);
  return result.ok ? { status: "delivered" } : failedOutcome(result.error, statusFailures);
}

async function queued(
  deps: KickEgressDeps,
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
        message: "too many Kick chat writes are waiting; try again shortly",
      };
    }
    case "abandoned": {
      return { status: "failed", code: "upstream", message: "did not reach Kick before the deadline" };
    }
  }
}

function failedOutcome(
  failure: KickApiFailure,
  statusFailures: Readonly<Partial<Record<number, FailureCode>>>
): PlatformOutcome {
  switch (failure.kind) {
    case "http": {
      return {
        status: "failed",
        code: statusFailures[failure.status] ?? STATUS_FAILURES[failure.status] ?? "upstream",
        message: failure.message,
      };
    }
    case "timeout": {
      return { status: "unconfirmed", message: "Kick did not answer in time; it may have acted" };
    }
    case "unreachable": {
      return { status: "failed", code: "upstream", message: `Kick could not be reached: ${failure.detail}` };
    }
    case "not_linked": {
      return { status: "failed", code: "forbidden", message: "Kick is not linked, or has to be linked again" };
    }
    case "malformed": {
      return { status: "unconfirmed", message: `Kick answered but its answer could not be read: ${failure.detail}` };
    }
  }
}

function refusedHere(message: string): PlatformOutcome {
  return { status: "failed", code: "invalid", message };
}
