import { z } from "zod";

/** Defaults for the Twitch adapter's tunables. */
export const TWITCH_DEFAULTS = {
  /** Where Twitch sends the browser back after an authorization with the engine's own app. */
  redirectUrl: "http://localhost",
  /** Out-of-band chatter membership enrichment (follower, subscription tier). */
  membershipEnrichmentEnabled: true,
  /** Unfollows raise no event, so only a TTL expires a resolved answer. */
  membershipTtlMs: 600_000,
  /** How long a chat message may wait on a cache miss before publishing without the unresolved fields. */
  membershipDeadlineMs: 250,
} as const;

// loadRuntimeEnv coerces env strings to boolean/number before the schema sees
// them, so the membership keys are declared as the types they mean.
export const TwitchEnvSchema = z.object({
  // Optional: without it the channel is whoever links Twitch, so an engine
  // can start before its streamer has linked an account.
  woofx3TwitchChannelName: z.string().optional(),
  // An engine's own Twitch app, for refreshing tokens itself. Absent when its
  // Twitch token comes from a dashboard, which owns the app and refreshes.
  woofx3TwitchClientId: z.string().optional(),
  woofx3TwitchClientSecret: z.string().optional(),
  woofx3TwitchRedirectUrl: z.string().default(TWITCH_DEFAULTS.redirectUrl),
  woofx3TwitchMembershipEnrichmentEnabled: z.boolean().default(TWITCH_DEFAULTS.membershipEnrichmentEnabled),
  woofx3TwitchMembershipTtlMs: z.number().int().positive().default(TWITCH_DEFAULTS.membershipTtlMs),
  woofx3TwitchMembershipDeadlineMs: z.number().int().positive().default(TWITCH_DEFAULTS.membershipDeadlineMs),
});

export type TwitchEnv = z.infer<typeof TwitchEnvSchema>;

/** The engine's own Twitch app, which refreshes the linked token itself. */
export interface TwitchAppCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface TwitchConfig {
  /** The channel to watch; undefined means the account that linked Twitch. */
  channel: string | undefined;
  /**
   * Set only when both the client id and secret are. The api reads the client
   * id alone for its own use, so an id without a secret is a dashboard-token
   * engine, not a mistake.
   */
  app: TwitchAppCredentials | undefined;
  /** Undefined when enrichment is switched off. */
  membership: { ttlMs: number; deadlineMs: number } | undefined;
}

export function twitchConfig(env: TwitchEnv): TwitchConfig {
  const clientId = nonBlank(env.woofx3TwitchClientId);
  const clientSecret = nonBlank(env.woofx3TwitchClientSecret);
  return {
    channel: nonBlank(env.woofx3TwitchChannelName),
    app:
      clientId !== undefined && clientSecret !== undefined
        ? { clientId, clientSecret, redirectUri: env.woofx3TwitchRedirectUrl }
        : undefined,
    membership: env.woofx3TwitchMembershipEnrichmentEnabled
      ? { ttlMs: env.woofx3TwitchMembershipTtlMs, deadlineMs: env.woofx3TwitchMembershipDeadlineMs }
      : undefined,
  };
}

function nonBlank(value: string | undefined): string | undefined {
  const text = value?.trim() ?? "";
  return text === "" ? undefined : text;
}
