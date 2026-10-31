/**
 * The Twitch scopes an engine asks for when it links Twitch itself (a device
 * login). They are the scopes a dashboard asks for, so an engine linked
 * either way can do the same things: must match `TWITCH_INTEGRATION_SCOPES`
 * in woofx3-ui's `shared/twitch-integration-scopes.ts`.
 *
 * This file imports nothing so the api service can use it without pulling in
 * the Twitch client's dependencies.
 */
export const TWITCH_ENGINE_SCOPES: readonly string[] = [
  "user:read:email",
  "user:bot",
  "user:write:chat",
  "user:read:chat",
  "chat:read",
  "chat:edit",
  "bits:read",
  "channel:manage:broadcast",
  "channel:manage:ads",
  "channel:read:ads",
  "channel:moderate",
  "channel:read:hype_train",
  "channel:read:polls",
  "channel:read:predictions",
  "channel:read:redemptions",
  "channel:read:subscriptions",
  "clips:edit",
  "moderator:manage:announcements",
  "moderator:manage:blocked_terms",
  "moderator:manage:shoutouts",
  "moderator:manage:banned_users",
  "moderator:manage:chat_messages",
  "moderator:manage:chat_settings",
  "moderator:read:chatters",
  "moderator:read:chat_messages",
  "moderator:read:chat_settings",
  "moderator:read:followers",
  "moderator:read:moderators",
  "moderator:read:unban_requests",
  "moderator:read:warnings",
  "moderator:read:vips",
];

/** A Twitch scope name: lower-case words joined by colons and underscores. */
const SCOPE_PATTERN = /^[a-z_]+(:[a-z_]+)*$/;

/** True when `scope` has the shape of a Twitch scope name. */
export function isScopeName(scope: unknown): scope is string {
  return typeof scope === "string" && scope.length <= 100 && SCOPE_PATTERN.test(scope);
}
