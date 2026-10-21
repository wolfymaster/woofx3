import { ENGINE_HOSTINGS, type EngineHosting, parseEngineHosting } from "@woofx3/api";
import { parseRequestGuardPolicy, type RequestGuardPolicy } from "@woofx3/common/http/request-guard";
import { loadRuntimeEnv } from "@woofx3/common/runtime";
import { z } from "zod";
import { type BarkloaderWebhookAuth, parseBarkloaderWebhookAuth } from "./barkloader-webhook-auth";
import { DEFAULT_MARKETPLACE_DOWNLOAD_HOSTS, DEFAULT_MARKETPLACE_URL, downloadOrigin } from "./marketplace-client";
import { type RegistrationPolicy, resolveRegistrationPolicy } from "./registration";
import { UNVERSIONED } from "./version";

export interface ApiConfig {
  /** The running release (`WOOFX3_VERSION`); see UNVERSIONED. */
  version: string;
  /**
   * The name the provisioner gave this engine (`WOOFX3_ENGINE_NAME`, e.g.
   * `eng-0a1b2c3d`), or null for an engine nobody named, such as a local one.
   * Reported publicly by `GET /health`.
   */
  engineName: string | null;
  /** How this engine is run (`WOOFX3_HOSTING`), or null when the deployment does not say. */
  hosting: EngineHosting | null;
  /**
   * Who may register a client (`WOOFX3_REGISTRATION_MODE`), and the secret a
   * caller presents (`WOOFX3_REGISTRATION_TOKEN` or
   * `WOOFX3_REGISTRATION_TOKEN_FILE`). See registration.ts.
   */
  registration: RegistrationPolicy;
  port: number;
  /**
   * Interface the HTTP server binds. Loopback unless configured otherwise:
   * a deployed engine is reached through its in-container edge, and every
   * other listener stays off the host's shared network.
   */
  host: string;
  rootDir: string;
  databaseProxyUrl: string;
  barkloaderUrl: string;
  /**
   * Barkloader's WebSocket endpoint. The api runs module functions over it
   * and waits for their result (a webhook handler's response, for one).
   */
  barkloaderWsUrl: string;
  /** Token barkloader requires on that WebSocket. */
  barkloaderKey: string;
  /**
   * Whether barkloader's processing callbacks must carry `barkloaderKey` as a
   * bearer token (`WOOFX3_BARKLOADER_WEBHOOK_AUTH`); see
   * barkloader-webhook-auth.ts.
   */
  barkloaderWebhookAuth: BarkloaderWebhookAuth;
  /**
   * URL of the streamware service that serves scene overlays. The UI's
   * browser-source page iframes `${streamwareUrl}/overlay/scene/{id}`
   * for streamware-backed scenes. Defaults to localhost:9101 (the
   * streamware default port) — override via `STREAMWARE_URL` env.
   */
  streamwareUrl: string;
  sceneManagerUrl: string;
  apiUrl: string;
  /**
   * Hosts and origins the HTTP server accepts (`WOOFX3_ALLOWED_HOSTS`,
   * `WOOFX3_ALLOWED_ORIGINS`); both open unless set. See
   * shared/common/typescript/http/request-guard.ts.
   */
  requestGuard: RequestGuardPolicy;
  /**
   * The marketplace this engine installs and reads the catalog from, or null
   * when the marketplace is turned off (`marketplaceUrl` set to blank).
   */
  marketplace: MarketplaceConfig | null;
  nats: {
    url: string;
    name: string;
    jwt?: string;
    nkeySeed?: string;
    token?: string;
  };
}

export interface MarketplaceConfig {
  /** `marketplaceUrl` / `WOOFX3_MARKETPLACE_URL`; the public marketplace when unset. */
  url: string;
  /**
   * `marketplaceDownloadHosts` / `WOOFX3_MARKETPLACE_DOWNLOAD_HOSTS`,
   * comma-separated: the hosts (HTTPS) or origins archive downloads may come
   * from. Defaults to where the public marketplace presigns them.
   */
  downloadHosts: string[];
}

export const ApiEnvSchema = z.looseObject({
  woofx3ApiPort: z.union([z.number(), z.string()]).optional(),
  apiPort: z.union([z.number(), z.string()]).optional(),
  woofx3ApiHost: z.string().optional(),
  apiHost: z.string().optional(),
  woofx3Version: z.union([z.string(), z.number()]).optional(),
  woofx3EngineName: z.string().optional(),
  woofx3Hosting: z.string().optional(),
  woofx3RegistrationToken: z.union([z.string(), z.number()]).optional(),
  woofx3RegistrationTokenFile: z.string().optional(),
  woofx3RegistrationMode: z.string().optional(),
  woofx3DatabaseProxyUrl: z.string().optional(),
  databaseProxyUrl: z.string().optional(),
  woofx3BarkloaderUrl: z.string().optional(),
  barkloaderUrl: z.string().optional(),
  woofx3BarkloaderWsUrl: z.string().optional(),
  barkloaderWsUrl: z.string().optional(),
  woofx3BarkloaderKey: z.string().optional(),
  barkloaderKey: z.string().optional(),
  woofx3BarkloaderWebhookAuth: z.string().optional(),
  woofx3StreamwareUrl: z.string().optional(),
  streamwareUrl: z.string().optional(),
  woofx3SceneManagerUrl: z.string().optional(),
  sceneManagerUrl: z.string().optional(),
  woofx3ApiUrl: z.string().optional(),
  apiUrl: z.string().optional(),
  woofx3MessagebusUrl: z.string().optional(),
  messagebusUrl: z.string().optional(),
  woofx3MessagebusJwt: z.string().optional(),
  messagebusJwt: z.string().optional(),
  woofx3MessagebusNkey: z.string().optional(),
  messagebusNkey: z.string().optional(),
  woofx3MessagebusToken: z.union([z.string(), z.number()]).optional(),
  messagebusToken: z.union([z.string(), z.number()]).optional(),
  woofx3RootPath: z.string().optional(),
  woofx3AllowedHosts: z.union([z.string(), z.number(), z.boolean()]).optional(),
  woofx3AllowedOrigins: z.union([z.string(), z.number(), z.boolean()]).optional(),
  woofx3MarketplaceUrl: z.string().optional(),
  marketplaceUrl: z.string().optional(),
  woofx3MarketplaceDownloadHosts: z.string().optional(),
  marketplaceDownloadHosts: z.string().optional(),
});

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

/**
 * `WOOFX3_HOSTING` as an `EngineHosting`, or null when unset or blank. Any
 * other value stops startup: a deployment that declares how it is run must
 * not be reported as one that did not.
 */
export function resolveHosting(value: unknown): EngineHosting | null {
  const raw = String(value ?? "").trim();
  if (raw === "") {
    return null;
  }
  const hosting = parseEngineHosting(raw);
  if (hosting === null) {
    throw new Error(`Config error: WOOFX3_HOSTING must be one of ${ENGINE_HOSTINGS.join(", ")}, got ${raw}`);
  }
  return hosting;
}

/** A setting's text, or undefined when it is unset or blank. */
function nonBlank(value: unknown): string | undefined {
  const text = value === undefined || value === null ? "" : String(value).trim();
  return text === "" ? undefined : text;
}

/**
 * The marketplace settings. An unset `marketplaceUrl` means the public
 * marketplace; one set to blank turns marketplace installs off, which an
 * engine that must never reach the internet wants. Malformed values fail at
 * startup rather than at the first install.
 */
export function resolveMarketplaceConfig(
  url: string | undefined,
  downloadHosts: string | undefined
): MarketplaceConfig | null {
  if (url !== undefined && url.trim() === "") {
    return null;
  }
  const resolvedUrl = (url ?? DEFAULT_MARKETPLACE_URL).trim();
  assertValidHttpUrl("marketplaceUrl (WOOFX3_MARKETPLACE_URL)", resolvedUrl);
  const hosts = (downloadHosts ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter((host) => host !== "");
  const resolvedHosts = hosts.length > 0 ? hosts : [...DEFAULT_MARKETPLACE_DOWNLOAD_HOSTS];
  for (const host of resolvedHosts) {
    try {
      downloadOrigin(host);
    } catch (err) {
      throw new Error(
        `Config error: marketplaceDownloadHosts (WOOFX3_MARKETPLACE_DOWNLOAD_HOSTS) entry ${host} is invalid — ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  return { url: resolvedUrl, downloadHosts: resolvedHosts };
}

export function loadConfig(): ApiConfig {
  const result = loadRuntimeEnv({ injectIntoProcess: true, schema: ApiEnvSchema });
  const config = result.config;

  const port = Number(config.woofx3ApiPort ?? config.apiPort ?? 8080);
  const host = String(config.woofx3ApiHost || config.apiHost || "127.0.0.1");
  const version = String(config.woofx3Version || UNVERSIONED);
  const engineName = String(config.woofx3EngineName ?? "").trim() || null;
  const hosting = resolveHosting(config.woofx3Hosting);
  const optionalString = (value: unknown): string | undefined => (value === undefined ? undefined : String(value));
  const registration = resolveRegistrationPolicy({
    mode: optionalString(config.woofx3RegistrationMode),
    token: optionalString(config.woofx3RegistrationToken),
    tokenFile: optionalString(config.woofx3RegistrationTokenFile),
  });
  const rootDir = String(config.woofx3RootPath);
  const databaseProxyUrl = String(config.woofx3DatabaseProxyUrl ?? config.databaseProxyUrl ?? "");
  const barkloaderUrl = String(config.woofx3BarkloaderUrl ?? config.barkloaderUrl ?? "http://127.0.0.1:3005");
  const barkloaderWsUrl = String(config.woofx3BarkloaderWsUrl ?? config.barkloaderWsUrl ?? "");
  const barkloaderKey = String(config.woofx3BarkloaderKey ?? config.barkloaderKey ?? "");
  const barkloaderWebhookAuth = parseBarkloaderWebhookAuth(
    config.woofx3BarkloaderWebhookAuth === undefined ? undefined : String(config.woofx3BarkloaderWebhookAuth)
  );
  const streamwareUrl = String(config.woofx3StreamwareUrl ?? config.streamwareUrl ?? "http://127.0.0.1:9101");

  const sceneManagerUrl = String(config.woofx3SceneManagerUrl ?? config.sceneManagerUrl ?? "");
  const apiUrl = String(config.woofx3ApiUrl ?? config.apiUrl ?? `http://127.0.0.1:${port}`);

  if (!databaseProxyUrl) {
    throw new Error("databaseProxyUrl (or DATABASE_PROXY_URL) is required");
  }
  if (!sceneManagerUrl) {
    throw new Error("sceneManagerUrl (WOOFX3_SCENE_MANAGER_URL) is required");
  }
  if (!barkloaderWsUrl) {
    throw new Error("barkloaderWsUrl (or WOOFX3_BARKLOADER_WS_URL) is required");
  }
  if (!barkloaderKey) {
    throw new Error("barkloaderKey (or WOOFX3_BARKLOADER_KEY) is required");
  }

  // Tiger Style: fail fast at startup on malformed URLs rather than
  // composing broken overlay URLs or proxying into the void at runtime.
  assertValidHttpUrl("streamwareUrl (WOOFX3_STREAMWARE_URL)", streamwareUrl);
  assertValidHttpUrl("sceneManagerUrl (WOOFX3_SCENE_MANAGER_URL)", sceneManagerUrl);
  assertValidHttpUrl("apiUrl (WOOFX3_API_URL)", apiUrl);

  const requestGuard = parseRequestGuardPolicy({
    allowedHosts: config.woofx3AllowedHosts,
    allowedOrigins: config.woofx3AllowedOrigins,
  });
  const marketplaceUrl = config.woofx3MarketplaceUrl ?? config.marketplaceUrl;
  const marketplaceDownloadHosts = config.woofx3MarketplaceDownloadHosts ?? config.marketplaceDownloadHosts;
  const marketplace = resolveMarketplaceConfig(
    marketplaceUrl === undefined ? undefined : String(marketplaceUrl),
    marketplaceDownloadHosts === undefined ? undefined : String(marketplaceDownloadHosts)
  );

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
  const messageBusToken = nonBlank(config.woofx3MessagebusToken) ?? nonBlank(config.messagebusToken);

  return {
    version,
    engineName,
    hosting,
    registration,
    port,
    host,
    databaseProxyUrl,
    barkloaderUrl,
    barkloaderWsUrl,
    barkloaderKey,
    barkloaderWebhookAuth,
    streamwareUrl,
    sceneManagerUrl,
    apiUrl,
    marketplace,
    rootDir,
    requestGuard,
    nats: {
      url: messageBusUrl,
      name: "woofx3-api",
      jwt: messageBusJwt,
      nkeySeed: messageBusNkey,
      token: messageBusToken,
    },
  };
}
