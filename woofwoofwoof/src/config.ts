import { validateSecret } from "@woofx3/common/runtime";
import { DB_PROXY_TOKEN_CONFIG_KEY } from "@woofx3/db/service-auth";
import { z } from "zod";
import { DEFAULT_SENT_LINE_CONFIG, type SentLineConfig } from "./sentLines";

// Schema field names are the camelCase versions of WOOFX3_-prefixed env keys
// (from .woofx3.json) or raw env keys (from .env / process.env).
// The key casing must match exactly what appears in .woofx3.json.
export const WoofEnvSchema = z.object({
  woofx3MessagebusUrl: z.string().min(1, "messagebusUrl is required in .woofx3.json"),
  woofx3MessagebusJwt: z.string().optional(),
  woofx3MessagebusNKey: z.string().optional(),
  // loadRuntimeEnv coerces an all-digit value to a number.
  woofx3MessagebusToken: z.union([z.string(), z.number()]).optional(),
  // Optional: without it the bot joins the channel of whoever links Twitch,
  // so it can start before its streamer has linked an account.
  woofx3TwitchChannelName: z.string().optional(),
  woofx3BarkloaderWsUrl: z.string().min(1, "barkloaderWsUrl is required in .woofx3.json"),
  woofx3BarkloaderKey: z.string().min(1, "barkloaderKey is required in .woofx3.json"),
  woofx3DatabaseProxyUrl: z.string().min(1, "databaseProxyUrl is required in .woofx3.json"),
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
  woofx3RootPath: z.string().optional(),
  twitchRedirectUrl: z.string().default("http://localhost"),
  // How many of the bot's own chat lines are remembered, and for how long, so
  // their echo on the chat feed is not read as a chatter's message.
  woofx3ChatSentLineCapacity: z.coerce.number().int().positive().default(DEFAULT_SENT_LINE_CONFIG.capacity),
  woofx3ChatSentLineTtlMs: z.coerce.number().int().positive().default(DEFAULT_SENT_LINE_CONFIG.ttlMs),
});

export type WoofEnvConfig = z.infer<typeof WoofEnvSchema>;

/** The sent-line registry's settings from validated config. */
export function sentLineConfig(config: { getConfig(key: string): unknown }): SentLineConfig {
  const capacity = config.getConfig("woofx3ChatSentLineCapacity");
  const ttlMs = config.getConfig("woofx3ChatSentLineTtlMs");
  if (typeof capacity !== "number" || typeof ttlMs !== "number") {
    throw new Error("sent-line config was not validated: capacity and ttl must be numbers");
  }
  return { capacity, ttlMs };
}
