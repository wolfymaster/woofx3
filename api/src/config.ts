import { ENGINE_HOSTINGS, type EngineHosting, parseEngineHosting } from "@woofx3/api";
import { CALLER_TIMEOUT_MS } from "@woofx3/api/platform-gateway";
import { RELAY_API_REQUEST_TIMEOUT_MS, RELAY_CONFIG_SET_BUDGET_MS } from "@woofx3/common/cloudevents/Relay/relay";
import { parseRequestGuardPolicy, type RequestGuardPolicy, resolveExposure } from "@woofx3/common/http/request-guard";
import { loadRuntimeEnv, validateSecret } from "@woofx3/common/runtime";
import { DB_PROXY_TOKEN_CONFIG_KEY } from "@woofx3/db/service-auth";
import { z } from "zod";
import { DEFAULT_AUTH_CACHE_TTL_MS } from "./auth";
import { type BarkloaderWebhookAuth, parseBarkloaderWebhookAuth } from "./barkloader-webhook-auth";
import { downloadOrigin } from "./guarded-download";
import { DEFAULT_MARKETPLACE_DOWNLOAD_HOSTS, DEFAULT_MARKETPLACE_URL } from "./marketplace-client";
import { assertRegistrationExposure, type RegistrationPolicy, resolveRegistrationPolicy } from "./registration";
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
  /**
   * Where the provisioner placed this engine (`WOOFX3_ENGINE_REGION`), in its
   * host's own region code (e.g. `iad`), or null when unset, as on a local
   * engine. Reported publicly by `GET /health`.
   */
  engineRegion: string | null;
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
  /** Service token db-proxy requires of every caller (`WOOFX3_DB_PROXY_TOKEN`). */
  dbProxyToken: string;
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
   * `WOOFX3_ALLOWED_ORIGINS`), with their defaults resolved. See
   * shared/common/typescript/http/request-guard.ts.
   */
  requestGuard: RequestGuardPolicy;
  /**
   * The marketplace this engine installs and reads the catalog from, or null
   * when the marketplace is turned off (`marketplaceUrl` set to blank).
   */
  marketplace: MarketplaceConfig | null;
  /**
   * The engine's public Twitch app (`WOOFX3_TWITCH_PUBLIC_CLIENT_ID`), which
   * device logins use, or null when it has none. Not the confidential app
   * (`WOOFX3_TWITCH_CLIENT_ID`): a public app has no secret.
   */
  twitchPublicClientId: string | null;
  /**
   * The engine's confidential Twitch app (`WOOFX3_TWITCH_CLIENT_ID`), or null
   * when it has none. The connectors host's Twitch adapter refreshes a token issued to it; the
   * api only names it on Helix calls.
   */
  twitchClientId: string | null;
  /**
   * How long a successful client credential check is reused, in milliseconds
   * (`WOOFX3_AUTH_CACHE_TTL_MS`); DEFAULT_AUTH_CACHE_TTL_MS when unset.
   */
  authCacheTtlMs: number;
  /**
   * How long `setRelayConfig` waits for the connectors host's companion
   * gateway to store a relay configuration, in milliseconds
   * (`WOOFX3_COMPANION_REQUEST_TIMEOUT_MS`); DEFAULT_COMPANION_REQUEST_TIMEOUT_MS when unset.
   */
  companionRequestTimeoutMs: number;
  /**
   * How long a send to the platform gateway waits for its reply, in
   * milliseconds (`WOOFX3_PLATFORM_GATEWAY_TIMEOUT_MS`); the contract's
   * CALLER_TIMEOUT_MS when unset.
   */
  platformGatewayTimeoutMs: number;
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
  woofx3EngineRegion: z.string().optional(),
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
  // loadRuntimeEnv coerces an all-digit value to a number.
  woofx3TwitchPublicClientId: z.union([z.string(), z.number()]).optional(),
  woofx3TwitchClientId: z.union([z.string(), z.number()]).optional(),
  woofx3AuthCacheTtlMs: z.union([z.number(), z.string()]).optional(),
  woofx3CompanionRequestTimeoutMs: z.union([z.number(), z.string()]).optional(),
  woofx3PlatformGatewayTimeoutMs: z.union([z.number(), z.string()]).optional(),
  // True where the edge listens beyond loopback and forwards to the api; the production image sets it.
  woofx3BehindEdge: z.boolean().optional(),
  woofx3DbProxyToken: z.string().optional(),
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

/** A Twitch client id: letters and digits only. */
const TWITCH_CLIENT_ID_PATTERN = /^[A-Za-z0-9]{1,64}$/;

/**
 * A Twitch app's client id, or null when unset or blank. A malformed one
 * stops startup rather than failing every Twitch call made with it.
 * `setting` names the config key and its variable for the error.
 */
function resolveTwitchClientId(value: unknown, setting: string): string | null {
  const clientId = nonBlank(value);
  if (clientId === undefined) {
    return null;
  }
  if (!TWITCH_CLIENT_ID_PATTERN.test(clientId)) {
    throw new Error(`Config error: ${setting} must be a Twitch client id (letters and digits)`);
  }
  return clientId;
}

/**
 * `WOOFX3_AUTH_CACHE_TTL_MS` as a positive whole number of milliseconds, or
 * DEFAULT_AUTH_CACHE_TTL_MS when unset or blank. Anything else stops startup.
 */
export function resolveAuthCacheTtlMs(value: unknown): number {
  const text = nonBlank(value);
  if (text === undefined) {
    return DEFAULT_AUTH_CACHE_TTL_MS;
  }
  const ttlMs = Number(text);
  if (!Number.isInteger(ttlMs) || ttlMs <= 0) {
    throw new Error(
      `Config error: woofx3AuthCacheTtlMs (WOOFX3_AUTH_CACHE_TTL_MS) must be a positive integer, got ${text}`
    );
  }
  return ttlMs;
}

/**
 * Above the companion gateway's budget for storing a relay configuration, so
 * its answer, a failure included, arrives before the api gives up.
 */
export const DEFAULT_COMPANION_REQUEST_TIMEOUT_MS = RELAY_API_REQUEST_TIMEOUT_MS;

/**
 * `WOOFX3_COMPANION_REQUEST_TIMEOUT_MS` as a whole number of milliseconds
 * above RELAY_CONFIG_SET_BUDGET_MS, or DEFAULT_COMPANION_REQUEST_TIMEOUT_MS
 * when unset or blank. Anything else stops startup.
 */
export function resolveCompanionRequestTimeoutMs(value: unknown): number {
  const text = nonBlank(value);
  if (text === undefined) {
    return DEFAULT_COMPANION_REQUEST_TIMEOUT_MS;
  }
  const timeoutMs = Number(text);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= RELAY_CONFIG_SET_BUDGET_MS) {
    throw new Error(
      `Config error: woofx3CompanionRequestTimeoutMs (WOOFX3_COMPANION_REQUEST_TIMEOUT_MS) must be an integer above the companion gateway's ${RELAY_CONFIG_SET_BUDGET_MS}ms budget, got ${text}`
    );
  }
  return timeoutMs;
}

/**
 * `WOOFX3_PLATFORM_GATEWAY_TIMEOUT_MS` as a whole number of milliseconds no
 * lower than the contract's CALLER_TIMEOUT_MS, or that default when unset
 * or blank. A lower wait would report a timeout for sends the gateway still
 * answers normally. Anything else stops startup.
 */
export function resolvePlatformGatewayTimeoutMs(value: unknown): number {
  const text = nonBlank(value);
  if (text === undefined) {
    return CALLER_TIMEOUT_MS;
  }
  const timeoutMs = Number(text);
  if (!Number.isInteger(timeoutMs) || timeoutMs < CALLER_TIMEOUT_MS) {
    throw new Error(
      `Config error: woofx3PlatformGatewayTimeoutMs (WOOFX3_PLATFORM_GATEWAY_TIMEOUT_MS) must be a whole number of at least ${CALLER_TIMEOUT_MS} (the gateway's caller window), got ${text}`
    );
  }
  return timeoutMs;
}

export function loadConfig(): ApiConfig {
  const result = loadRuntimeEnv({ injectIntoProcess: true, schema: ApiEnvSchema });
  const config = result.config;

  const port = Number(config.woofx3ApiPort ?? config.apiPort ?? 8080);
  const host = String(config.woofx3ApiHost || config.apiHost || "127.0.0.1");
  const version = String(config.woofx3Version || UNVERSIONED);
  const engineName = String(config.woofx3EngineName ?? "").trim() || null;
  const engineRegion = String(config.woofx3EngineRegion ?? "").trim() || null;
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
  const barkloaderKeyCheck = validateSecret("barkloaderKey", barkloaderKey);
  if (!barkloaderKeyCheck.ok) {
    throw new Error(barkloaderKeyCheck.error.message);
  }
  const dbProxyTokenCheck = validateSecret(DB_PROXY_TOKEN_CONFIG_KEY, String(config.woofx3DbProxyToken ?? ""));
  if (!dbProxyTokenCheck.ok) {
    throw new Error(dbProxyTokenCheck.error.message);
  }

  // Tiger Style: fail fast at startup on malformed URLs rather than
  // composing broken overlay URLs or proxying into the void at runtime.
  assertValidHttpUrl("streamwareUrl (WOOFX3_STREAMWARE_URL)", streamwareUrl);
  assertValidHttpUrl("sceneManagerUrl (WOOFX3_SCENE_MANAGER_URL)", sceneManagerUrl);
  assertValidHttpUrl("apiUrl (WOOFX3_API_URL)", apiUrl);

  const exposure = resolveExposure(host, config.woofx3BehindEdge === true);
  assertRegistrationExposure(registration, exposure);
  const requestGuard = parseRequestGuardPolicy({
    allowedHosts: config.woofx3AllowedHosts,
    allowedOrigins: config.woofx3AllowedOrigins,
    exposure,
    // barkloader calls the api at apiUrl; behind the edge both apps share sceneManagerUrl's origin.
    ownUrls: [apiUrl, sceneManagerUrl],
    extraDefaultOrigins: [],
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
  const twitchPublicClientId = resolveTwitchClientId(
    config.woofx3TwitchPublicClientId,
    "woofx3TwitchPublicClientId (WOOFX3_TWITCH_PUBLIC_CLIENT_ID)"
  );
  const twitchClientId = resolveTwitchClientId(
    config.woofx3TwitchClientId,
    "woofx3TwitchClientId (WOOFX3_TWITCH_CLIENT_ID)"
  );
  const messageBusToken = nonBlank(config.woofx3MessagebusToken) ?? nonBlank(config.messagebusToken);
  const authCacheTtlMs = resolveAuthCacheTtlMs(config.woofx3AuthCacheTtlMs);
  const companionRequestTimeoutMs = resolveCompanionRequestTimeoutMs(config.woofx3CompanionRequestTimeoutMs);
  const platformGatewayTimeoutMs = resolvePlatformGatewayTimeoutMs(config.woofx3PlatformGatewayTimeoutMs);

  return {
    version,
    engineName,
    engineRegion,
    hosting,
    registration,
    port,
    host,
    databaseProxyUrl,
    dbProxyToken: dbProxyTokenCheck.value,
    barkloaderUrl,
    barkloaderWsUrl,
    barkloaderKey,
    barkloaderWebhookAuth,
    streamwareUrl,
    sceneManagerUrl,
    apiUrl,
    marketplace,
    twitchPublicClientId,
    twitchClientId,
    rootDir,
    requestGuard,
    authCacheTtlMs,
    companionRequestTimeoutMs,
    platformGatewayTimeoutMs,
    nats: {
      url: messageBusUrl,
      name: "woofx3-api",
      jwt: messageBusJwt,
      nkeySeed: messageBusNkey,
      token: messageBusToken,
    },
  };
}
