/**
 * Who renews the linked Twitch account's token.
 *
 * - `dashboard`: a dashboard's Twitch app issued it. The dashboard keeps the
 *   refresh token and the app secret, so the engine asks that dashboard for a
 *   new token instead of refreshing.
 * - `engineRefresh`: the engine's own Twitch app issued it, and the engine
 *   refreshes it with its own app credentials.
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
