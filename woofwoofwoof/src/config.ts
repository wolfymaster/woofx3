import { z } from "zod";

// Schema field names are the camelCase versions of WOOFX3_-prefixed env keys
// (from .woofx3.json) or raw env keys (from .env / process.env).
// The key casing must match exactly what appears in .woofx3.json.
export const WoofEnvSchema = z.object({
  woofx3MessagebusUrl: z.string().min(1, "messagebusUrl is required in .woofx3.json"),
  woofx3MessagebusJwt: z.string().optional(),
  woofx3MessagebusNKey: z.string().optional(),
  woofx3TwitchChannelName: z.string().min(1, "WOOFX3_TWITCH_CHANNEL_NAME is required"),
  woofx3BarkloaderWsUrl: z.string().min(1, "barkloaderWsUrl is required in .woofx3.json"),
  woofx3DatabaseProxyUrl: z.string().min(1, "databaseProxyUrl is required in .woofx3.json"),
  woofx3ApplicationId: z.string().min(1, "APPLICATION_ID is required"),
  woofx3TwitchClientId: z.string().min(1, "TWITCH_WOLFY_CLIENT_ID is required"),
  woofx3TwitchClientSecret: z.string().min(1, "TWITCH_WOLFY_CLIENT_SECRET is required"),
  twitchRedirectUrl: z.string().default("http://localhost"),
  spotifyClientId: z.string().optional(),
  spotifyClientSecret: z.string().optional(),
  spotifyAccessToken: z.string().optional(),
  spotifyRefreshToken: z.string().optional(),
});

export type WoofEnvConfig = z.infer<typeof WoofEnvSchema>;
