import { z } from "zod";
import { type BusConfig, BusEnvSchema, busConfig } from "./config/bus";
import { type HostConfig, HostEnvSchema, hostConfig, hostConfigProblems } from "./config/host";

export const ConnectorsEnvSchema = BusEnvSchema.extend(HostEnvSchema.shape)
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
  host: HostConfig;
  /** Logs go under <rootPath>/logs. */
  rootPath: string | undefined;
}

/** Validates the loaded config and shapes it for the host. Throws, naming every bad key, when it is invalid. */
export function connectorsConfig(env: Record<string, unknown>): ConnectorsConfig {
  const parsed = ConnectorsEnvSchema.parse(env);
  return {
    bus: busConfig(parsed),
    dbProxyUrl: parsed.woofx3DatabaseProxyUrl,
    host: hostConfig(parsed),
    rootPath: parsed.woofx3RootPath,
  };
}
