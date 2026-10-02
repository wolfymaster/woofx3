import { z } from "zod";

// Schema field names are the camelCase versions of WOOFX3_-prefixed env keys
// (from .woofx3.json) or raw env keys (from .env / process.env).
// The key casing must match exactly what appears in .woofx3.json.
export const WoofEnvSchema = z.object({
  woofx3MessagebusUrl: z.string().min(1, "messagebusUrl is required in .woofx3.json"),
  woofx3MessagebusJwt: z.string().optional(),
  woofx3MessagebusNKey: z.string().optional(),
  // Optional: without it the bot joins the channel of whoever links Twitch,
  // so it can start before its streamer has linked an account.
  woofx3TwitchChannelName: z.string().optional(),
  woofx3BarkloaderWsUrl: z.string().min(1, "barkloaderWsUrl is required in .woofx3.json"),
  woofx3BarkloaderKey: z.string().min(1, "barkloaderKey is required in .woofx3.json"),
  woofx3DatabaseProxyUrl: z.string().min(1, "databaseProxyUrl is required in .woofx3.json"),
  // An engine's own Twitch app, for refreshing tokens itself. Absent when its
  // Twitch token comes from a dashboard, which owns the app and refreshes.
  woofx3TwitchClientId: z.string().optional(),
  woofx3TwitchClientSecret: z.string().optional(),
  woofx3RootPath: z.string().optional(),
  twitchRedirectUrl: z.string().default("http://localhost"),
});

export type WoofEnvConfig = z.infer<typeof WoofEnvSchema>;
