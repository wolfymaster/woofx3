import { loadRuntimeEnv } from "@woofx3/common/runtime";
import { z } from "zod";

export interface StreamwareConfig {
  port: number;
  rootDir: string;
  uiDistDir: string;
  publicDir: string;
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

const envSchema = z
  .object({
    woofx3StreamwarePort: z.union([z.number(), z.string()]).optional(),
    streamwarePort: z.union([z.number(), z.string()]).optional(),
    woofx3RootPath: z.string().optional(),
    rootPath: z.string().optional(),
    woofx3MessagebusUrl: z.string().optional(),
    messagebusUrl: z.string().optional(),
    woofx3MessagebusJwt: z.string().optional(),
    messagebusJwt: z.string().optional(),
    woofx3MessagebusNkey: z.string().optional(),
    messagebusNkey: z.string().optional(),
    woofx3ObsHost: z.string().optional(),
    obsHost: z.string().optional(),
    woofx3ObsPort: z.union([z.number(), z.string()]).optional(),
    obsPort: z.union([z.number(), z.string()]).optional(),
    woofx3ObsRpcToken: z.string().optional(),
    obsRpcToken: z.string().optional(),
  })
  .passthrough();

export function loadConfig(): StreamwareConfig {
  const result = loadRuntimeEnv({ injectIntoProcess: true, schema: envSchema });
  const c = result.config;

  const port = Number(c.woofx3StreamwarePort ?? c.streamwarePort ?? 9101);
  const rootDir = String(c.woofx3RootPath ?? c.rootPath ?? process.cwd());

  const messagebusUrl = String(
    c.woofx3MessagebusUrl ?? c.messagebusUrl ?? "ws://localhost:4225",
  );
  const jwt = c.woofx3MessagebusJwt != null
    ? String(c.woofx3MessagebusJwt)
    : c.messagebusJwt != null
      ? String(c.messagebusJwt)
      : undefined;
  const nkeySeed = c.woofx3MessagebusNkey != null
    ? String(c.woofx3MessagebusNkey)
    : c.messagebusNkey != null
      ? String(c.messagebusNkey)
      : undefined;

  const obsHost = String(c.woofx3ObsHost ?? c.obsHost ?? "127.0.0.1");
  const obsPort = String(c.woofx3ObsPort ?? c.obsPort ?? "4455");
  const obsToken = c.woofx3ObsRpcToken != null
    ? String(c.woofx3ObsRpcToken)
    : c.obsRpcToken != null
      ? String(c.obsRpcToken)
      : undefined;

  return {
    port,
    rootDir,
    uiDistDir: `${import.meta.dir}/../ui/dist`,
    publicDir: `${import.meta.dir}/../public`,
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
