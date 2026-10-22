import type { CreateMarkerArgs, TimeoutArgs, UpdateStreamArgs } from "@woofx3/common/cloudevents/Twitch/commands";
import TwitchApiEvents from "@woofx3/common/cloudevents/Twitch/commands";
import { z } from "zod";
import type { TwitchApiReplyCode } from "../adapters/twitch/lib/twitchApiError";
import { errorMessage } from "../host/deps";
import type { ScopedBus } from "../host/scoped-bus";

/** The CloudEvent type of every `twitchapi` refusal. Must match TWITCHAPI_ERROR_TYPE in adapters/twitch/application.ts. */
const TWITCHAPI_ERROR_TYPE = "twitchapi.error";

/** Every code a `twitchapi.error` reply can carry; the record type keeps it in step with the adapter's codes. */
const REPLY_CODES = {
  missing_scope: true,
  unauthorized: true,
  rate_limited: true,
  invalid_arguments: true,
  not_linked: true,
  integration_unavailable: true,
} as const satisfies Record<TwitchApiReplyCode, true>;

function isReplyCode(code: unknown): code is TwitchApiReplyCode {
  return typeof code === "string" && Object.hasOwn(REPLY_CODES, code);
}

/**
 * Why a `twitchapi` call produced no result:
 * - no_answer: nothing came back in time; Twitch may still have acted;
 * - unreachable: nothing serves the subject;
 * - refused: the adapter answered with an error, with a `code` when the caller can act on it;
 * - failed: the request or its reply was unusable.
 */
export type TwitchApiFailure =
  | { kind: "no_answer" }
  | { kind: "unreachable" }
  | { kind: "refused"; message: string; code: TwitchApiReplyCode | undefined }
  | { kind: "failed"; message: string };

export type TwitchApiResult<T> = { ok: true; value: T } | { ok: false; failure: TwitchApiFailure };

const updateStreamResult = z.object({ title: z.string().optional(), categoryName: z.string().optional() });
const markerResult = z.object({ positionSeconds: z.number().finite().nonnegative() });
const refusalData = z.object({ error: z.string(), code: z.unknown().optional() });
const replyEnvelope = z.object({ type: z.string(), data: z.unknown() });

export type UpdateStreamResult = z.infer<typeof updateStreamResult>;
export type StreamMarkerResult = z.infer<typeof markerResult>;

/** The `twitchapi` calls the built-in commands make. */
export interface TwitchApiPort {
  timeout(args: TimeoutArgs): Promise<TwitchApiResult<null>>;
  updateStream(args: UpdateStreamArgs): Promise<TwitchApiResult<UpdateStreamResult>>;
  createMarker(args: CreateMarkerArgs): Promise<TwitchApiResult<StreamMarkerResult>>;
}

export interface TwitchApiClientDeps {
  bus: Pick<ScopedBus, "request">;
  /** How long a call waits for the adapter's answer. */
  timeoutMs: number;
}

/**
 * A typed client for the Twitch adapter's `twitchapi` request subject. Every
 * call settles with a result; none rejects, so a command handler maps a
 * failure to a chat line instead of catching.
 */
export class TwitchApiClient implements TwitchApiPort {
  private readonly events = new TwitchApiEvents();

  constructor(private readonly deps: TwitchApiClientDeps) {
    if (!(Number.isInteger(deps.timeoutMs) && deps.timeoutMs > 0)) {
      throw new Error(`the twitchapi timeout must be a positive whole number of milliseconds, got ${deps.timeoutMs}`);
    }
  }

  timeout(args: TimeoutArgs): Promise<TwitchApiResult<null>> {
    return this.call(
      this.events.timeout(args),
      z.unknown().transform(() => null)
    );
  }

  updateStream(args: UpdateStreamArgs): Promise<TwitchApiResult<UpdateStreamResult>> {
    return this.call(this.events.updateStream(args), updateStreamResult);
  }

  createMarker(args: CreateMarkerArgs): Promise<TwitchApiResult<StreamMarkerResult>> {
    return this.call(this.events.createMarker(args), markerResult);
  }

  private async call<T>([subject, data]: [string, Uint8Array], schema: z.ZodType<T>): Promise<TwitchApiResult<T>> {
    let reply: Uint8Array;
    try {
      reply = (await this.deps.bus.request(subject, data, { timeout: this.deps.timeoutMs })).data;
    } catch (error) {
      return { ok: false, failure: requestFailure(error) };
    }
    return readReply(reply, schema);
  }
}

function readReply<T>(reply: Uint8Array, schema: z.ZodType<T>): TwitchApiResult<T> {
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(reply));
  } catch {
    return failed("the Twitch service sent a reply that is not JSON");
  }
  const envelope = replyEnvelope.safeParse(body);
  if (!envelope.success) {
    return failed("the Twitch service sent a reply that is not an event");
  }
  if (envelope.data.type === TWITCHAPI_ERROR_TYPE) {
    const refusal = refusalData.safeParse(envelope.data.data);
    if (!refusal.success) {
      return failed("the Twitch service refused the request");
    }
    const { error, code } = refusal.data;
    return { ok: false, failure: { kind: "refused", message: error, code: isReplyCode(code) ? code : undefined } };
  }
  const value = schema.safeParse(envelope.data.data);
  if (!value.success) {
    return failed("the Twitch service sent a reply of an unexpected shape");
  }
  return { ok: true, value: value.data };
}

function failed(message: string): TwitchApiResult<never> {
  return { ok: false, failure: { kind: "failed", message } };
}

/** The NATS client's request failures, told apart by name and message. */
function requestFailure(error: unknown): TwitchApiFailure {
  const name = error instanceof Error ? error.name : "";
  const message = errorMessage(error);
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause.name : "";
  if (name === "TimeoutError" || message.toLowerCase() === "timeout") {
    return { kind: "no_answer" };
  }
  if (cause === "NoResponders" || message.includes("no responders") || message.includes("503")) {
    return { kind: "unreachable" };
  }
  return { kind: "failed", message };
}

/**
 * The chat line for a call that did not succeed, naming what the chatter
 * asked for as `action` ("change the title"). A timeout is told as unknown
 * rather than failed: Twitch may have applied the change after the wait ran
 * out, and a chatter told it failed would retry a change that already happened.
 */
export function failureReply(action: string, failure: TwitchApiFailure): string {
  switch (failure.kind) {
    case "no_answer":
      return `No answer from Twitch yet, so it is unknown whether I could ${action}; it may still apply`;
    case "unreachable":
      return `Could not ${action}: Twitch is not reachable right now`;
    case "refused":
      if (failure.code === "integration_unavailable") {
        return `Twitch is not available right now, so I could not ${action}`;
      }
      if (failure.code === "not_linked") {
        return `Twitch is not linked yet, so I could not ${action}`;
      }
      return `Could not ${action}: ${failure.message}`;
    case "failed":
      return `Could not ${action}: ${failure.message}`;
  }
}
