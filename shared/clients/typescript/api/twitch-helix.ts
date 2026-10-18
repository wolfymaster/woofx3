/**
 * The engine's Twitch methods (`twitchGetChannelInformation` and the rest)
 * each perform one Helix call with the linked broadcaster's token and answer
 * with what Twitch answered. They mirror the calls a dashboard makes straight
 * to Helix, so a dashboard that switches to them reads the same bodies with
 * the same parsers. See docs/services/twitch-channel.md.
 */

/**
 * Why a Twitch method has no answer from Twitch.
 *
 * - `helix`: Twitch answered with an error status; `status` and `body` are
 *   Twitch's.
 * - `invalid_arguments`: the engine refused the arguments before calling
 *   Twitch (an unknown or misshapen parameter).
 * - `not_linked`: no Twitch account is linked to the engine.
 * - `unavailable`: the engine's twitch service is not running.
 * - `timeout`: the twitch service did not answer within 10 seconds. Twitch
 *   may still have acted.
 * - `failed`: anything else; `error` says what.
 */
export type TwitchHelixErrorCode = "helix" | "invalid_arguments" | "not_linked" | "unavailable" | "timeout" | "failed";

/**
 * A Twitch method's outcome. A refusal is a result rather than a thrown
 * error, because an RPC error carries only its message across the wire.
 */
export type TwitchHelixResult =
  /** `body` is Helix's JSON body unchanged; null when Twitch sent none (204). */
  | { ok: true; body: unknown }
  /** `body` is Twitch's error body as text, usually `{"error","status","message"}`. */
  | { ok: false; code: "helix"; error: string; status: number; body: string }
  | { ok: false; code: Exclude<TwitchHelixErrorCode, "helix">; error: string };

/** `GET /helix/games`: one category, by id. */
export interface TwitchGetGamesParams {
  id: string;
}

/** `GET /helix/search/categories`. */
export interface TwitchSearchCategoriesParams {
  query: string;
  first?: number;
}

/**
 * `PATCH /helix/channels`, by Helix's names. An absent field is left as it
 * is; `game_id: ""` clears the category.
 */
export interface TwitchModifyChannelInformationParams {
  title?: string;
  game_id?: string;
  tags?: string[];
}

/** `POST /helix/streams/markers`. The marker is placed on the broadcaster's stream. */
export interface TwitchCreateStreamMarkerParams {
  description?: string;
}

/** `GET /helix/users`: one user, by id or by login. */
export interface TwitchGetUsersParams {
  id?: string;
  login?: string;
}

/** `GET /helix/moderation/blocked_terms`: one page. */
export interface TwitchGetBlockedTermsParams {
  first?: number;
  /** The previous page's `pagination.cursor`. */
  after?: string;
}

/** `POST /helix/moderation/blocked_terms`. */
export interface TwitchAddBlockedTermParams {
  text: string;
}

/** `DELETE /helix/moderation/blocked_terms`. */
export interface TwitchRemoveBlockedTermParams {
  id: string;
}

/**
 * `POST /helix/moderation/bans`: the fields of the body's `data`. A
 * `duration` in seconds makes it a timeout.
 */
export interface TwitchBanUserParams {
  user_id: string;
  duration?: number;
  reason?: string;
}

/** `DELETE /helix/moderation/bans`: lifts a ban or a timeout. */
export interface TwitchUnbanUserParams {
  user_id: string;
}

/** `PATCH /helix/chat/settings`: the modes to change, by Helix's names. */
export interface TwitchUpdateChatSettingsParams {
  emote_mode?: boolean;
  subscriber_mode?: boolean;
  follower_mode?: boolean;
  /** Minutes. */
  follower_mode_duration?: number;
  slow_mode?: boolean;
  /** Seconds. */
  slow_mode_wait_time?: number;
}
