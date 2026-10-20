/**
 * Who renews the linked Twitch account's token.
 *
 * - `dashboard`: a dashboard's Twitch app issued it. The dashboard keeps the
 *   refresh token and the app secret, so the engine asks that dashboard for a
 *   new token instead of refreshing.
 * - `engineRefresh`: the engine's own Twitch app issued it, and the engine
 *   refreshes it itself. A token from the engine's public app (a device
 *   login, see `publicClientIdOf`) is refreshed by the api service alone; one
 *   from a confidential app is refreshed with that app's credentials.
 *
 * Both the api service (`api/src/twitch-token-source.ts`) and the Twitch
 * client (`./index.ts`) pick the strategy with `selectStrategy`, so they can
 * never disagree about who owns a stored token.
 *
 * This file imports nothing so the api service can use it without pulling in
 * the Twitch client's dependencies.
 */
export type TokenStrategy = "dashboard" | "engineRefresh";

/**
 * The strategy for a stored `twitch_token` value. A token carries its issuing
 * app's `clientId` only when a dashboard sent it (the api service's
 * `setTwitchToken` stores it that way); the engine's own tokens never do.
 */
export function selectStrategy(stored: object): TokenStrategy {
  const { clientId } = stored as { clientId?: unknown };
  if (typeof clientId === "string" && clientId !== "") {
    return "dashboard";
  }
  return "engineRefresh";
}

/**
 * The client id of the engine's public Twitch app when that app issued the
 * stored token (a device login), or null for any other token.
 *
 * Such a token is `engineRefresh`, but its refresh tokens are single-use: if
 * two services refreshed it, the second would spend a refresh token the first
 * had already spent and lose the link. So the api service alone refreshes it,
 * and every other service asks the api service for the current access token,
 * as it does for a dashboard's.
 */
export function publicClientIdOf(stored: object): string | null {
  if (selectStrategy(stored) !== "engineRefresh") {
    return null;
  }
  const { publicClientId } = stored as { publicClientId?: unknown };
  return typeof publicClientId === "string" && publicClientId !== "" ? publicClientId : null;
}
