import { z } from "zod";
import { type BusConfig, BusEnvSchema, busConfig } from "./config/bus";
import { type GatewayConfig, GatewayEnvSchema, gatewayConfig } from "./config/gateway";
import { type HostConfig, HostEnvSchema, hostConfig, hostConfigProblems } from "./config/host";
import { type ObsConfig, ObsEnvSchema, obsConfig } from "./config/obs";
import { type TwitchConfig, TwitchEnvSchema, twitchConfig } from "./config/twitch";

export const ConnectorsEnvSchema = BusEnvSchema.extend(HostEnvSchema.shape)
  .extend(GatewayEnvSchema.shape)
  .extend(TwitchEnvSchema.shape)
  .extend(ObsEnvSchema.shape)
  .extend({ woofx3RootPath: z.string().optional() })
  .superRefine((env, ctx) => {
    for (const message of hostConfigProblems(env)) {
      ctx.addIssue({ code: "custom", message });
    }
  });

export type ConnectorsEnv = z.infer<typeof ConnectorsEnvSchema>;

export interface ConnectorsConfig {
  bus: BusConfig;
  dbProxyUrl: string;
  /** The service token db-proxy requires on every call. */
  dbProxyToken: string;
  host: HostConfig;
  gateway: GatewayConfig;
  twitch: TwitchConfig;
  obs: ObsConfig;
  /** Logs go under <rootPath>/logs. */
  rootPath: string | undefined;
}

/** Validates the loaded config and shapes it for the host. Throws, naming every bad key, when it is invalid. */
export function connectorsConfig(env: Record<string, unknown>): ConnectorsConfig {
  const parsed = ConnectorsEnvSchema.parse(env);
  return {
    bus: busConfig(parsed),
    dbProxyUrl: parsed.woofx3DatabaseProxyUrl,
    dbProxyToken: parsed.woofx3DbProxyToken,
    host: hostConfig(parsed),
    gateway: gatewayConfig(parsed),
    twitch: twitchConfig(parsed),
    obs: obsConfig(parsed),
    rootPath: parsed.woofx3RootPath,
  };
}
