/**
 * Linking Twitch from the engine itself, with Twitch's Device Code Grant and
 * the engine's public Twitch app, for an engine with no dashboard to run
 * OAuth for it (local mode). The engine starts the login and polls Twitch;
 * a client only shows the streamer the code and where to type it, then reads
 * the outcome. See docs/services/twitch-channel.md.
 */

/** A device login the engine has started. */
export interface TwitchDeviceLogin {
  loginId: string;
  /** The code the streamer types at `verificationUri`. */
  userCode: string;
  verificationUri: string;
  /** ISO 8601. After this the code no longer works and a new login is needed. */
  expiresAt: string;
}

/**
 * Why a device login could not start.
 *
 * - `not_configured`: this engine has no public Twitch app client id
 *   (`WOOFX3_TWITCH_PUBLIC_CLIENT_ID`).
 * - `invalid_scopes`: a scope given is not a Twitch scope name, or the list
 *   is empty.
 * - `failed`: Twitch refused or could not be reached; `error` says which.
 */
export type TwitchDeviceLoginStartErrorCode = "not_configured" | "invalid_scopes" | "failed";

/** `startTwitchDeviceLogin`'s outcome. A refusal is a result, since an RPC error carries only its message. */
export type TwitchDeviceLoginStartResult =
  | { ok: true; login: TwitchDeviceLogin }
  | { ok: false; code: TwitchDeviceLoginStartErrorCode; error: string };

/**
 * Where a device login stands.
 *
 * - `pending`: waiting for the streamer to approve at the verification page.
 * - `linked`: approved; the token is stored and the account is linked.
 * - `expired`: the code expired before the streamer approved.
 * - `denied`: the streamer refused.
 * - `failed`: Twitch refused the login, or the token it issued could not be
 *   validated or stored; `reason` says which.
 */
export type TwitchDeviceLoginStatus = "pending" | "linked" | "expired" | "denied" | "failed";

export interface TwitchDeviceLoginState {
  loginId: string;
  status: TwitchDeviceLoginStatus;
  /** Why the login ended other than `linked`, or the last transient error while `pending`. */
  reason?: string;
  /** ISO 8601, as `TwitchDeviceLogin.expiresAt`. */
  expiresAt: string;
  /** The account that was linked. Present only when `status` is `linked`. */
  linked?: { userId: string; login: string };
}

/**
 * `getTwitchDeviceLogin`'s outcome. `not_found` means the engine has no login
 * by that id: it was cancelled, replaced by a newer login, or ended long
 * enough ago to be forgotten.
 */
export type TwitchDeviceLoginStateResult =
  | { ok: true; state: TwitchDeviceLoginState }
  | { ok: false; code: "not_found"; error: string };
