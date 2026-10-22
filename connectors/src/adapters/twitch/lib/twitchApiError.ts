/**
 * A refusal a caller can act on without parsing the message: the dispatcher
 * sends `code` alongside the message in the `twitchapi.error` reply. Codes
 * are part of the `twitchapi` contract (docs/services/twitch-channel.md).
 */
export class TwitchApiError extends Error {
  constructor(
    readonly code: TwitchApiErrorCode,
    message: string
  ) {
    super(message);
    this.name = "TwitchApiError";
  }
}

/**
 * Why a Twitch call failed, in terms a caller can act on, so a caller can tell
 * "reconnect Twitch" from "wait and retry" without parsing messages. `failed`
 * is everything else; it stays in process and is never sent as a `code`.
 */
export type TwitchApiErrorCode = "missing_scope" | "unauthorized" | "rate_limited" | "invalid_arguments" | "failed";

/**
 * Every `code` a `twitchapi.error` reply can carry: an actionable
 * TwitchApiError code, `not_linked` (no Twitch account is linked), or
 * `integration_unavailable` (linked, but the adapter is turned off or not
 * running). The connectors host sends the last two for any command while the
 * adapter is down; the adapter itself sends `not_linked` for `helix` only.
 */
export type TwitchApiReplyCode = Exclude<TwitchApiErrorCode, "failed"> | "not_linked" | "integration_unavailable";

/** The contract code a thrown error carries, if it is a TwitchApiError with an actionable code. */
export function twitchApiErrorCodeOf(err: unknown): Exclude<TwitchApiErrorCode, "failed"> | undefined {
  if (err instanceof TwitchApiError && err.code !== "failed") {
    return err.code;
  }
  return undefined;
}

/** Twurple's HttpStatusCodeError, matched by shape so this file needs no import of its package. */
export function httpStatusOf(err: unknown): number | undefined {
  if (err && typeof err === "object" && "statusCode" in err && typeof err.statusCode === "number") {
    return err.statusCode;
  }
  return undefined;
}
