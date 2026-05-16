import { loadRuntimeEnv } from "@woofx3/common/runtime";
import { z } from "zod";

export const StreamwareEnvSchema = z.object({
  woofx3StreamwarePort: z.union([z.number(), z.string()]).default("9101"),
  streamwarePort: z.union([z.number(), z.string()]).optional(),
  woofx3RootPath: z.string().optional(),
  rootPath: z.string().optional(),
  woofx3MessagebusUrl: z.string().default("ws://localhost:4225"),
  messagebusUrl: z.string().optional(),
  woofx3MessagebusJwt: z.string().optional(),
  messagebusJwt: z.string().optional(),
  woofx3MessagebusNkey: z.string().optional(),
  messagebusNkey: z.string().optional(),
  woofx3ObsHost: z.string().default("127.0.0.1"),
  obsHost: z.string().optional(),
  woofx3ObsPort: z.union([z.number(), z.string()]).default("4455"),
  obsPort: z.union([z.number(), z.string()]).optional(),
  woofx3ObsRpcToken: z.string().optional(),
  obsRpcToken: z.string().optional(),
  woofx3DatabaseProxyUrl: z.string().default(""),
  databaseProxyUrl: z.string().optional(),
});

export type StreamwareConfig = z.infer<typeof StreamwareEnvSchema>;

export interface StreamwareRuntimeConfig {
  port: number;
  rootDir: string;
  uiDistDir: string;
  publicDir: string;
  databaseProxyUrl: string;
  obs: {
    url: string;
    token?: string;
  };
  nats: {
    url: string;
    name: string;
    jwt?: string;
    nkeySeed?: string;
  };
}

export function loadConfig(): StreamwareRuntimeConfig {
  const result = loadRuntimeEnv({ injectIntoProcess: true, schema: StreamwareEnvSchema });
  const c = result.config;

  const port = Number(c.woofx3StreamwarePort ?? c.streamwarePort ?? 9101);
  const rootDir = String(c.woofx3RootPath ?? c.rootPath ?? process.cwd());

  const messagebusUrl = String(c.woofx3MessagebusUrl ?? c.messagebusUrl ?? "ws://localhost:4225");
  const jwt = c.woofx3MessagebusJwt ? String(c.woofx3MessagebusJwt) : c.messagebusJwt ? String(c.messagebusJwt) : undefined;
  const nkeySeed = c.woofx3MessagebusNkey ? String(c.woofx3MessagebusNkey) : c.messagebusNkey ? String(c.messagebusNkey) : undefined;

  const obsHost = String(c.woofx3ObsHost ?? c.obsHost ?? "127.0.0.1");
  const obsPort = String(c.woofx3ObsPort ?? c.obsPort ?? "4455");
  const obsToken = c.woofx3ObsRpcToken ? String(c.woofx3ObsRpcToken) : c.obsRpcToken ? String(c.obsRpcToken) : undefined;

  const databaseProxyUrl = String(c.woofx3DatabaseProxyUrl ?? c.databaseProxyUrl ?? "");

  return {
    port,
    rootDir,
    uiDistDir: `${import.meta.dir}/../ui/dist`,
    publicDir: `${import.meta.dir}/../public`,
    databaseProxyUrl,
    obs: {
      url: `ws://${obsHost}:${obsPort}`,
      token: obsToken,
    },
    nats: {
      url: messagebusUrl,
      name: "woofx3-streamware",
      jwt,
      nkeySeed,
    },
  };
}