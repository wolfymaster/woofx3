import { z } from "zod";
import { nonBlank, unsetWhenBlank } from "./env";

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
  /** How long one membership lookup may run before it counts as failed and frees its in-flight slot. */
  membershipLoadTimeoutMs: 10_000,
  /** How long a failed membership lookup is remembered, so a missing scope does not mean one request per chat message. */
  membershipFailureTtlMs: 60_000,
  /** Cap on cached chatters, so a raid cannot grow the cache without bound. */
  membershipMaxEntries: 5000,
  /**
   * How many chat writes from the platform gateway may wait behind the one
   * being sent. One more is refused as rate limited rather than queued, which
   * bounds memory and pending handlers. A line whose caller stopped waiting is
   * dropped from the queue by its deadline, not by this cap.
   */
  sendQueueCap: 100,
  /**
   * How many of the engine's own chat lines are remembered while their echo
   * is awaited. Far above what the send queue lets through in `selfSentTtlMs`.
   */
  selfSentCapacity: 256,
  /** How long an own line waits for its echo; EventSub delivers one within a few seconds. */
  selfSentTtlMs: 30_000,
  /**
   * How often the ad schedule is read while the stream is live. The
   * announcement is armed as a timer from each read, so this bounds how late
   * a moved ad is noticed, not how late its announcement lands.
   */
  adSchedulePollIntervalMs: 60_000,
  /**
   * How long one ad schedule read may take before it counts as failed. Must
   * stay below `adSchedulePollIntervalMs`; the scheduler refuses to start otherwise.
   */
  adScheduleReadTimeoutMs: 15_000,
  /** How long the ad schedule is left alone after a missing scope, which only a relink fixes. */
  adScheduleMissingScopeBackoffMs: 15 * 60_000,
  /** How long the ad schedule is left alone after Twitch refuses the token. */
  adScheduleUnauthorizedBackoffMs: 5 * 60_000,
  /** The ad schedule's backoff after consecutive rate limits: jittered, doubling from base to max. */
  adScheduleRateLimitBackoff: { baseMs: 2 * 60_000, maxMs: 30 * 60_000 },
  /**
   * How long a connect waits for Twitch to confirm the EventSub
   * subscriptions before reporting what it has. Confirmations only start
   * after `session_welcome`, so this must comfortably exceed connect time.
   */
  subscriptionSettleTimeoutMs: 20_000,
  /**
   * How long a shoutout waits for the api service to queue it, which waits up
   * to 5s for the dashboard. Under the 10s a module's `ctx.twitch` call waits
   * for the twitch adapter, so a slow dashboard surfaces as this error rather
   * than as the sandbox's own timeout.
   */
  shoutoutEnqueueTimeoutMs: 8_000,
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
  woofx3TwitchRedirectUrl: z.preprocess(unsetWhenBlank, z.url().default(TWITCH_DEFAULTS.redirectUrl)),
  woofx3TwitchMembershipEnrichmentEnabled: z.boolean().default(TWITCH_DEFAULTS.membershipEnrichmentEnabled),
  woofx3TwitchMembershipTtlMs: z.number().int().positive().default(TWITCH_DEFAULTS.membershipTtlMs),
  woofx3TwitchMembershipDeadlineMs: z.number().int().positive().default(TWITCH_DEFAULTS.membershipDeadlineMs),
  woofx3TwitchSendQueueCap: z.number().int().nonnegative().default(TWITCH_DEFAULTS.sendQueueCap),
  woofx3TwitchSelfSentCapacity: z.number().int().positive().default(TWITCH_DEFAULTS.selfSentCapacity),
  woofx3TwitchSelfSentTtlMs: z.number().int().positive().default(TWITCH_DEFAULTS.selfSentTtlMs),
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
  membership:
    | { ttlMs: number; deadlineMs: number; loadTimeoutMs: number; failureTtlMs: number; maxEntries: number }
    | undefined;
  /** See TWITCH_DEFAULTS.sendQueueCap. */
  sendQueueCap: number;
  /** See TWITCH_DEFAULTS.selfSentCapacity and selfSentTtlMs. */
  selfSent: { capacity: number; ttlMs: number };
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
      ? {
          ttlMs: env.woofx3TwitchMembershipTtlMs,
          deadlineMs: env.woofx3TwitchMembershipDeadlineMs,
          loadTimeoutMs: TWITCH_DEFAULTS.membershipLoadTimeoutMs,
          failureTtlMs: TWITCH_DEFAULTS.membershipFailureTtlMs,
          maxEntries: TWITCH_DEFAULTS.membershipMaxEntries,
        }
      : undefined,
    sendQueueCap: env.woofx3TwitchSendQueueCap,
    selfSent: { capacity: env.woofx3TwitchSelfSentCapacity, ttlMs: env.woofx3TwitchSelfSentTtlMs },
  };
}
