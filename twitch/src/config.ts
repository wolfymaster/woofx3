import { z } from "zod";
import { DEFAULT_SELF_SENT_CONFIG, type SelfSentConfig } from "./lib/selfSentChat";

export const TwitchEnvSchema = z.object({
  woofx3MessagebusUrl: z.string().min(1, "woofx3MessagebusUrl is required"),
  woofx3MessagebusJwt: z.string().optional(),
  woofx3MessagebusNKey: z.string().optional(),
  // loadRuntimeEnv coerces an all-digit value to a number.
  woofx3MessagebusToken: z.union([z.string(), z.number()]).optional(),
  // Optional: without it the channel is whoever links Twitch, so an engine
  // can start before its streamer has linked an account.
  woofx3TwitchChannelName: z.string().optional(),
  woofx3DatabaseProxyUrl: z.string().min(1, "woofx3DatabaseProxyUrl is required"),
  // An engine's own Twitch app, for refreshing tokens itself. Absent when its
  // Twitch token comes from a dashboard, which owns the app and refreshes.
  woofx3TwitchClientId: z.string().optional(),
  woofx3TwitchClientSecret: z.string().optional(),
  woofx3TwitchRedirectUrl: z.string().default("http://localhost"),
  woofx3RootPath: z.string().optional(),

  // Out-of-band chatter membership enrichment (follower, subscription tier).
  // loadRuntimeEnv coerces env strings to boolean/number before the schema
  // sees them, so these are declared as the types they mean.
  woofx3TwitchMembershipEnrichmentEnabled: z.boolean().default(true),
  // Unfollows raise no event, so only a TTL expires a resolved answer.
  woofx3TwitchMembershipTtlMs: z.number().int().positive().default(600_000),
  // How long a chat message may wait on a cache miss before publishing without
  // the unresolved fields.
  woofx3TwitchMembershipDeadlineMs: z.number().int().positive().default(250),

  // The chat lines this service said, remembered until Twitch hands them back
  // on the chat feed so they are published as the engine's own.
  woofx3TwitchSelfSentCapacity: z.number().int().positive().default(DEFAULT_SELF_SENT_CONFIG.capacity),
  woofx3TwitchSelfSentTtlMs: z.number().int().positive().default(DEFAULT_SELF_SENT_CONFIG.ttlMs),
});

export type TwitchEnvConfig = z.infer<typeof TwitchEnvSchema>;

/** The self-sent registry's settings, from config the runtime has validated against TwitchEnvSchema. */
export function selfSentConfig(config: { getConfig: (key: string) => unknown }): SelfSentConfig {
  return {
    capacity: config.getConfig("woofx3TwitchSelfSentCapacity") as number,
    ttlMs: config.getConfig("woofx3TwitchSelfSentTtlMs") as number,
  };
}
