import { loadRuntimeEnv } from "@woofx3/common/runtime";
import { z } from "zod";

export interface ApiConfig {
  port: number;
  databaseProxyUrl: string;
  applicationId: string;
  nats: {
    url: string;
    name: string;
    jwt?: string;
    nkeySeed?: string;
  };
}

const apiEnvSchema = z
  .object({
    woofx3ApiPort: z.union([z.number(), z.string()]).optional(),
    apiPort: z.union([z.number(), z.string()]).optional(),
    woofx3DatabaseProxyUrl: z.string().optional(),
    databaseProxyUrl: z.string().optional(),
    woofx3ApplicationId: z.string().optional(),
    applicationId: z.string().optional(),
    woofx3MessagebusUrl: z.string().optional(),
    messagebusUrl: z.string().optional(),
    woofx3MessagebusJwt: z.string().optional(),
    messagebusJwt: z.string().optional(),
    woofx3MessagebusNkey: z.string().optional(),
    messagebusNkey: z.string().optional(),
  })
  .passthrough();

export function loadConfig(): ApiConfig {
  const result = loadRuntimeEnv({ injectIntoProcess: true, schema: apiEnvSchema });
  const config = result.config;

  const port = Number(config.woofx3ApiPort ?? config.apiPort ?? 8080);
  const databaseProxyUrl = String(config.woofx3DatabaseProxyUrl ?? config.databaseProxyUrl ?? "");
  const applicationId = String(config.woofx3ApplicationId ?? config.applicationId ?? "");

  if (!databaseProxyUrl) {
    throw new Error("databaseProxyUrl (or DATABASE_PROXY_URL) is required");
  }

  if (!applicationId) {
    throw new Error("applicationId (or APPLICATION_ID) is required");
  }

  const messageBusUrl = String(config.woofx3MessagebusUrl ?? config.messagebusUrl ?? "nats://localhost:4222");
  const messageBusJwt =
    config.woofx3MessagebusJwt != null
      ? String(config.woofx3MessagebusJwt)
      : config.messagebusJwt != null
        ? String(config.messagebusJwt)
        : undefined;
  const messageBusNkey =
    config.woofx3MessagebusNkey != null
      ? String(config.woofx3MessagebusNkey)
      : config.messagebusNkey != null
        ? String(config.messagebusNkey)
        : undefined;

  return {
    port,
    databaseProxyUrl,
    applicationId,
    nats: {
      url: messageBusUrl,
      name: "woofx3-api",
      jwt: messageBusJwt,
      nkeySeed: messageBusNkey,
    },
  };
}
