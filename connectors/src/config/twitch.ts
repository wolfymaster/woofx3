import { validateSecret } from "@woofx3/common/runtime";
import { DB_PROXY_TOKEN_CONFIG_KEY } from "@woofx3/db/service-auth";
import { z } from "zod";

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
  // Defaults to blank so a missing token fails with the secret rule's message.
  woofx3DbProxyToken: z
    .string()
    .default("")
    .superRefine((value, ctx) => {
      const check = validateSecret(DB_PROXY_TOKEN_CONFIG_KEY, value);
      if (!check.ok) {
        ctx.addIssue({ code: "custom", message: check.error.message });
      }
    }),
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
});

export type TwitchEnvConfig = z.infer<typeof TwitchEnvSchema>;
