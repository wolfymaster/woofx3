import { loadRuntimeEnv } from "@woofx3/common/runtime";
import { z } from "zod";

export interface ApiConfig {
  port: number;
  rootDir: string;
  databaseProxyUrl: string;
  barkloaderUrl: string;
  /**
   * URL of the streamware service that serves scene overlays. The UI's
   * browser-source page iframes `${streamwareUrl}/overlay/scene/{id}`
   * for streamware-backed scenes. Defaults to localhost:9101 (the
   * streamware default port) — override via `STREAMWARE_URL` env.
   */
  streamwareUrl: string;
  /**
   * Public base URL the api's overlay gateway is reachable at. Used to
   * compose the `url` returned by mintOverlayToken / rotateOverlayToken /
   * listOverlayTokens (`${overlayPublicUrl}/overlay/{token}/`). Defaults
   * to the api's own loopback address — override via
   * `WOOFX3_OVERLAY_PUBLIC_URL` when the api sits behind a tunnel or
   * reverse proxy.
   */
  overlayPublicUrl: string;
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
    woofx3BarkloaderUrl: z.string().optional(),
    barkloaderUrl: z.string().optional(),
    woofx3StreamwareUrl: z.string().optional(),
    streamwareUrl: z.string().optional(),
    woofx3OverlayPublicUrl: z.string().optional(),
    overlayPublicUrl: z.string().optional(),
    woofx3MessagebusUrl: z.string().optional(),
    messagebusUrl: z.string().optional(),
    woofx3MessagebusJwt: z.string().optional(),
    messagebusJwt: z.string().optional(),
    woofx3MessagebusNkey: z.string().optional(),
    messagebusNkey: z.string().optional(),
    woofx3RootPath: z.string().optional(),
  })
  .passthrough();

/**
 * Tiger Style invariant: assert that a config value is a valid http(s) URL.
 * Throws at startup rather than silently producing a broken proxy or
 * a malformed overlay URL at request time.
 */
function assertValidHttpUrl(label: string, value: string): void {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`expected http or https protocol, got ${parsed.protocol}`);
    }
  } catch (err) {
    throw new Error(
      `Config error: ${label} is not a valid http(s) URL: ${value} — ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export function loadConfig(): ApiConfig {
  const result = loadRuntimeEnv({ injectIntoProcess: true, schema: apiEnvSchema });
  const config = result.config;

  const port = Number(config.woofx3ApiPort ?? config.apiPort ?? 8080);
  const rootDir = String(config.woofx3RootPath);
  const databaseProxyUrl = String(config.woofx3DatabaseProxyUrl ?? config.databaseProxyUrl ?? "");
  const barkloaderUrl = String(config.woofx3BarkloaderUrl ?? config.barkloaderUrl ?? "http://127.0.0.1:3005");
  const streamwareUrl = String(
    config.woofx3StreamwareUrl ?? config.streamwareUrl ?? "http://127.0.0.1:9101",
  );

  const overlayPublicUrl = String(
    config.woofx3OverlayPublicUrl ?? config.overlayPublicUrl ?? `http://127.0.0.1:${port}`,
  );

  if (!databaseProxyUrl) {
    throw new Error("databaseProxyUrl (or DATABASE_PROXY_URL) is required");
  }

  // Tiger Style: fail fast at startup on malformed URLs rather than
  // composing broken overlay URLs or proxying into the void at runtime.
  assertValidHttpUrl("streamwareUrl (WOOFX3_STREAMWARE_URL)", streamwareUrl);
  assertValidHttpUrl("overlayPublicUrl (WOOFX3_OVERLAY_PUBLIC_URL)", overlayPublicUrl);

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
    barkloaderUrl,
    streamwareUrl,
    overlayPublicUrl,
    rootDir,
    nats: {
      url: messageBusUrl,
      name: "woofx3-api",
      jwt: messageBusJwt,
      nkeySeed: messageBusNkey,
    },
  };
}
