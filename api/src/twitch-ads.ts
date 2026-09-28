import type { AdSchedule, AdSnoozeResult } from "@woofx3/api";

/**
 * Codes the twitch service stamps on an error reply (`TwitchApiErrorCode` in
 * twitch/src/lib/twitch.ts). `unlinked` and `unavailable` are added here: the
 * first for the service's "not linked yet" reply, the second for a request
 * that never got an answer.
 */
export type TwitchCommandErrorCode =
  | "missing_scope"
  | "unauthorized"
  | "rate_limited"
  | "failed"
  | "unlinked"
  | "unavailable";

export class TwitchCommandError extends Error {
  constructor(
    readonly code: TwitchCommandErrorCode,
    message: string
  ) {
    super(message);
    this.name = "TwitchCommandError";
  }
}

/** The one method of the NATS client this module uses, so tests can fake it. */
export interface NatsRequester {
  request(subject: string, data: Uint8Array, opts?: { timeout?: number }): Promise<{ data: Uint8Array }>;
}

const TWITCHAPI_SUBJECT = "twitchapi";
const REQUEST_TIMEOUT_MS = 10_000;
const KNOWN_CODES: ReadonlySet<string> = new Set(["missing_scope", "unauthorized", "rate_limited", "failed"]);

/**
 * Sends one command to the twitch service and returns its result, or throws
 * a `TwitchCommandError` whose code says what the caller can do about it.
 *
 * Only the engine calls these: the ad commands are deliberately absent from
 * the module sandbox's Twitch extension, since snoozing an ad is the
 * streamer's decision, not a module's.
 */
export async function requestTwitchCommand<T>(nats: NatsRequester, command: string): Promise<T> {
  const envelope = {
    id: crypto.randomUUID(),
    type: `twitchapi.${command}`,
    source: "api",
    time: new Date().toISOString(),
    data: { command, args: {} },
  };

  let replyBytes: Uint8Array;
  try {
    const reply = await nats.request(TWITCHAPI_SUBJECT, new TextEncoder().encode(JSON.stringify(envelope)), {
      timeout: REQUEST_TIMEOUT_MS,
    });
    replyBytes = reply.data;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new TwitchCommandError("unavailable", `${command}: the twitch service did not answer (${message})`);
  }

  const reply = JSON.parse(new TextDecoder().decode(replyBytes)) as {
    type?: string;
    data?: { error?: string; code?: string } & Record<string, unknown>;
  };
  if (reply.type === "twitchapi.error") {
    const message = reply.data?.error ?? `${command} failed`;
    const code = reply.data?.code;
    if (code !== undefined && KNOWN_CODES.has(code)) {
      throw new TwitchCommandError(code as TwitchCommandErrorCode, message);
    }
    if (/not linked/i.test(message)) {
      throw new TwitchCommandError("unlinked", message);
    }
    throw new TwitchCommandError("failed", message);
  }
  return reply.data as T;
}

export function fetchAdSchedule(nats: NatsRequester): Promise<AdSchedule> {
  return requestTwitchCommand<AdSchedule>(nats, "getAdSchedule");
}

export function requestAdSnooze(nats: NatsRequester): Promise<AdSnoozeResult> {
  return requestTwitchCommand<AdSnoozeResult>(nats, "snoozeNextAd");
}
