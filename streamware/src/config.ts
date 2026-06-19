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
  // Overlay host (WP-3). Defaults match the api's BARKLOADER_URL default.
  woofx3BarkloaderUrl: z.string().default("http://127.0.0.1:3005"),
  barkloaderUrl: z.string().optional(),
  // Streamware binds loopback by default; the api proxy is the public surface.
  woofx3StreamwareHost: z.string().default("127.0.0.1"),
  streamwareHost: z.string().optional(),
  // Legacy direct routes (/overlay/alerts, /overlay/scene/{id}, /api/scene/{id},
  // /ws/alerts, /ws/module-state, public fall-through). Default true for now;
  // flips false at the end of the overlay work (design 2.2).
  woofx3StreamwareLegacyRoutes: z.union([z.boolean(), z.string()]).default(true),
  streamwareLegacyRoutes: z.union([z.boolean(), z.string()]).optional(),
  // CDN override for widget asset bases (design 2.5). Empty -> relative <base>.
  woofx3WidgetAssetBaseUrl: z.string().default(""),
  widgetAssetBaseUrl: z.string().optional(),
});

export type StreamwareConfig = z.infer<typeof StreamwareEnvSchema>;

export interface StreamwareRuntimeConfig {
  port: number;
  /** Bind hostname. Loopback by default — the api proxy is the public surface. */
  bindHost: string;
  rootDir: string;
  uiDistDir: string;
  publicDir: string;
  databaseProxyUrl: string;
  /** Barkloader asset origin for module widget bundles. */
  barkloaderUrl: string;
  /** Absolute CDN base for widget assets; empty -> relative <base> (design 2.5). */
  widgetAssetBaseUrl: string;
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

/** Coerce env-style boolean flags ("false", "0", false) to a boolean. */
export function coerceFlag(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (lowered === "false" || lowered === "0" || lowered === "no") {
      return false;
    }
    if (lowered === "true" || lowered === "1" || lowered === "yes") {
      return true;
    }
  }
  return fallback;
}

/**
 * Fail-fast validation for the overlay host (design 2.2: bind address
 * asserted at startup; barkloader origin must be a usable URL because
 * the frame assembler and widget-asset proxy depend on it).
 * Throws on invalid input — callers exit rather than continue
 * in an inconsistent state.
 */
export function validateOverlayConfig(config: StreamwareRuntimeConfig): void {
  if (!config.bindHost) {
    throw new Error("streamware: bindHost must not be empty (WOOFX3_STREAMWARE_HOST)");
  }
  if (!config.barkloaderUrl) {
    throw new Error("streamware: barkloaderUrl must not be empty (WOOFX3_BARKLOADER_URL)");
  }
  try {
    new URL(config.barkloaderUrl);
  } catch {
    throw new Error(`streamware: barkloaderUrl is not a valid URL: ${config.barkloaderUrl}`);
  }
  if (config.widgetAssetBaseUrl) {
    try {
      new URL(config.widgetAssetBaseUrl);
    } catch {
      throw new Error(
        `streamware: widgetAssetBaseUrl is not a valid URL: ${config.widgetAssetBaseUrl}`
      );
    }
  }
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
  const barkloaderUrl = String(c.woofx3BarkloaderUrl ?? c.barkloaderUrl ?? "http://127.0.0.1:3005");
  const bindHost = String(c.woofx3StreamwareHost ?? c.streamwareHost ?? "127.0.0.1");
  const widgetAssetBaseUrl = String(c.woofx3WidgetAssetBaseUrl ?? c.widgetAssetBaseUrl ?? "");

  return {
    port,
    bindHost,
    rootDir,
    uiDistDir: `${import.meta.dir}/../ui/dist`,
    publicDir: `${import.meta.dir}/../public`,
    databaseProxyUrl,
    barkloaderUrl,
    widgetAssetBaseUrl,
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