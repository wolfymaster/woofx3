import { z } from "zod";

export const TwitchEnvSchema = z.object({
  woofx3MessagebusUrl: z.string().min(1, "woofx3MessagebusUrl is required"),
  woofx3MessagebusJwt: z.string().optional(),
  woofx3MessagebusNKey: z.string().optional(),
  woofx3TwitchChannelName: z.string().min(1, "woofx3TwitchChannelName is required"),
  woofx3DatabaseProxyUrl: z.string().min(1, "woofx3DatabaseProxyUrl is required"),
  woofx3ApplicationId: z.string().min(1, "applicationId is required"),
  woofx3TwitchClientId: z.string().min(1, "twitchClientId is required"),
  woofx3TwitchClientSecret: z.string().min(1, "twitchClientSecret is required"),
  woofx3TwitchRedirectUrl: z.string().default("http://localhost"),
  woofx3RootPath: z.string().optional(),
});

export type TwitchEnvConfig = z.infer<typeof TwitchEnvSchema>;
