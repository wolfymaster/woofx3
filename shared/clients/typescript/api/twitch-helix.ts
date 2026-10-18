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
