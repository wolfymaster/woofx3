import { z } from "zod";

export const TwitchEnvSchema = z.object({
  woofx3MessagebusUrl: z.string().min(1, "woofx3MessagebusUrl is required"),
  woofx3MessagebusJwt: z.string().optional(),
  woofx3MessagebusNKey: z.string().optional(),
  woofx3TwitchChannelName: z.string().min(1, "woofx3TwitchChannelName is required"),
  woofx3DatabaseProxyUrl: z.string().min(1, "woofx3DatabaseProxyUrl is required"),
  woofx3TwitchClientId: z.string().min(1, "twitchClientId is required"),
  woofx3TwitchClientSecret: z.string().min(1, "twitchClientSecret is required"),
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
});

export type TwitchEnvConfig = z.infer<typeof TwitchEnvSchema>;
