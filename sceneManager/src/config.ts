import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  parseRequestGuardPolicy,
  parseUiOrigins,
  type RequestGuardPolicy,
  resolveExposure,
} from "@woofx3/common/http/request-guard";
import { dataDir, loadRuntimeEnv, validateSecret } from "@woofx3/common/runtime";
import { DB_PROXY_TOKEN_CONFIG_KEY } from "@woofx3/db/service-auth";
import { WIDGET_HOST_SHIM_FILE } from "@woofx3/widget-host/frame";
import { z } from "zod";

/** How the OBS overlay refresh request is made and retried (obs/refresh-request.ts). */
export interface ObsRefreshConfig {
  /** How long one request waits for a reply. */
  requestTimeoutMs: number;
  /** The first retry's backoff ceiling; it doubles up to `retryMaxMs`. */
  retryBaseMs: number;
  retryMaxMs: number;
  /** The failed attempt after which one warning says the retrying goes on in the background. */
  warnAfterAttempts: number;
}

export const OBS_REFRESH_DEFAULTS: ObsRefreshConfig = {
  requestTimeoutMs: 2_000,
  retryBaseMs: 1_000,
  retryMaxMs: 30_000,
  warnAfterAttempts: 5,
};

export const SceneManagerEnvSchema = z.object({
  woofx3SceneManagerPort: z.union([z.number(), z.string()]).default("9101"),
  // sceneManager binds loopback by default: a reverse proxy (or direct
  // exposure in dev) is the public surface, never assumed here.
  woofx3SceneManagerHost: z.string().default("127.0.0.1"),
  // HS256 signing secret for the short-lived session JWT minted at
  // `GET /scene/{sceneId}`. Required and checked by validateConfig: fail
  // fast rather than run with an absent or guessable secret.
  woofx3SceneManagerTokenSecret: z.string().optional(),
  woofx3RootPath: z.string().optional(),
  woofx3MessagebusUrl: z.string().default("ws://localhost:4225"),
  woofx3MessagebusJwt: z.string().optional(),
  woofx3MessagebusNkey: z.string().optional(),
  woofx3MessagebusToken: z.union([z.string(), z.number()]).optional(),
  woofx3DatabaseProxyUrl: z.string().default(""),
  woofx3BarkloaderUrl: z.string().default("http://127.0.0.1:9653"),
  // The engine secret barkloader verifies media proxy URLs with (see
  // scene/media-proxy.ts); sceneManager signs them with it.
  woofx3BarkloaderKey: z.string().optional(),
  // Host and Origin allowlists (shared/common/typescript/http/request-guard.ts).
  woofx3AllowedHosts: z.union([z.string(), z.number(), z.boolean()]).optional(),
  woofx3AllowedOrigins: z.union([z.string(), z.number(), z.boolean()]).optional(),
  // The URL OBS and the dashboard reach sceneManager at; its host and origin
  // join the request guard's defaults.
  woofx3SceneManagerUrl: z.string().optional(),
  // The dashboard's origins (parseUiOrigins); the scene editor's WebSocket comes from there.
  woofx3UiUrl: z.union([z.string(), z.number(), z.boolean()]).optional(),
  // True where the edge listens beyond loopback and forwards to sceneManager; the production image sets it.
  woofx3BehindEdge: z.boolean().optional(),
  woofx3DbProxyToken: z.string().optional(),
  woofx3SceneManagerObsRefreshRequestTimeoutMs: z
    .union([z.number(), z.string()])
    .default(OBS_REFRESH_DEFAULTS.requestTimeoutMs),
  woofx3SceneManagerObsRefreshRetryBaseMs: z.union([z.number(), z.string()]).default(OBS_REFRESH_DEFAULTS.retryBaseMs),
  woofx3SceneManagerObsRefreshRetryMaxMs: z.union([z.number(), z.string()]).default(OBS_REFRESH_DEFAULTS.retryMaxMs),
});

export interface SceneManagerRuntimeConfig {
  port: number;
  bindHost: string;
  tokenSecret: string;
  rootDir: string;
  publicDir: string;
  /** Where Google Fonts families are kept once fetched (see google-font-cache.ts). */
  fontCacheDir: string;
  databaseProxyUrl: string;
  /** Service token db-proxy requires of every caller. */
  dbProxyToken: string;
  barkloaderUrl: string;
  /**
   * The engine secret: signs the media proxy URLs barkloader verifies
   * (scene/media-proxy.ts) and authenticates to barkloader's management routes.
   */
  barkloaderKey: string;
  /** Which Host and Origin headers the HTTP server accepts, with their defaults resolved. */
  requestGuard: RequestGuardPolicy;
  obsRefresh: ObsRefreshConfig;
  nats: {
    url: string;
    name: string;
    jwt?: string;
    nkeySeed?: string;
    token?: string;
  };
}

/**
 * Fail-fast validation: assert the invariants the rest of the service
 * depends on at startup rather than surfacing them as confusing runtime
 * failures later.
 */
export function validateConfig(config: SceneManagerRuntimeConfig): void {
  if (!config.bindHost) {
    throw new Error("sceneManager: bindHost must not be empty (WOOFX3_SCENE_MANAGER_HOST)");
  }
  // Session and editor tokens are signed with tokenSecret, and media proxy
  // URLs and barkloader requests with barkloaderKey: a guessable secret lets
  // anyone forge any of them.
  assertSecret("sceneManagerTokenSecret", config.tokenSecret);
  assertSecret("barkloaderKey", config.barkloaderKey);
  assertSecret(DB_PROXY_TOKEN_CONFIG_KEY, config.dbProxyToken);
  if (!config.barkloaderUrl) {
    throw new Error("sceneManager: barkloaderUrl must not be empty (WOOFX3_BARKLOADER_URL)");
  }
  try {
    new URL(config.barkloaderUrl);
  } catch {
    throw new Error(`sceneManager: barkloaderUrl is not a valid URL: ${config.barkloaderUrl}`);
  }
  const refresh = config.obsRefresh;
  for (const [name, value] of [
    ["obsRefresh.requestTimeoutMs", refresh.requestTimeoutMs],
    ["obsRefresh.retryBaseMs", refresh.retryBaseMs],
    ["obsRefresh.retryMaxMs", refresh.retryMaxMs],
    ["obsRefresh.warnAfterAttempts", refresh.warnAfterAttempts],
  ] as const) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`sceneManager: ${name} must be a positive whole number of milliseconds, got ${value}`);
    }
  }
  if (refresh.retryMaxMs < refresh.retryBaseMs) {
    throw new Error("sceneManager: obsRefresh.retryMaxMs must not be below obsRefresh.retryBaseMs");
  }
  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) {
    throw new Error(
      `sceneManager: port must be a whole number from 0 to 65535 (WOOFX3_SCENE_MANAGER_PORT), got ${config.port}`
    );
  }
  // Every scene, token and delivery is read through the db proxy: without it
  // the service would start and then fail every request.
  try {
    new URL(config.databaseProxyUrl);
  } catch {
    throw new Error(
      `sceneManager: databaseProxyUrl must be a valid URL (WOOFX3_DATABASE_PROXY_URL), got "${config.databaseProxyUrl}"`
    );
  }
  // The shim is a build output (`bun run build:shim`), not a tracked file, so
  // a checkout or release that skipped that step would serve widget frames
  // that 404 on it.
  const shimPath = join(config.publicDir, WIDGET_HOST_SHIM_FILE);
  if (!existsSync(shimPath)) {
    throw new Error(`sceneManager: widget host shim not found at ${shimPath} -- run \`bun run build:shim\``);
  }
}

function assertSecret(name: string, value: string): void {
  const result = validateSecret(name, value);
  if (!result.ok) {
    throw new Error(`sceneManager: ${result.error.message}`);
  }
}

/**
 * Where the static files sceneManager serves itself live (the widget host
 * shim, the scene client, vendored scripts).
 *
 * A compiled release binary is what runs in the image, and its
 * `import.meta.dir` points inside the bundle rather than at the deploy
 * directory, so the executable's own directory is checked first -- that is
 * where the build copies `public/`. From source, `import.meta.dir` is `src/`
 * and the files are beside it in `../public`.
 *
 * `execDir` is a parameter so the choice can be tested without a compiled
 * binary; callers pass nothing.
 */
export function resolvePublicDir(metaDir: string, execDir: string = dirname(process.execPath)): string {
  const candidates = [join(execDir, "public"), join(metaDir, "public"), join(metaDir, "..", "public")];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[candidates.length - 1] as string;
}

/** A setting's text, or undefined when it is unset or blank. */
function nonBlank(value: unknown): string | undefined {
  const text = value === undefined || value === null ? "" : String(value).trim();
  return text === "" ? undefined : text;
}

export function loadConfig(): SceneManagerRuntimeConfig {
  const result = loadRuntimeEnv({ injectIntoProcess: true, schema: SceneManagerEnvSchema });
  const c = result.config;

  const port = Number(c.woofx3SceneManagerPort ?? 9101);
  const bindHost = String(c.woofx3SceneManagerHost ?? "127.0.0.1");
  const tokenSecret = String(c.woofx3SceneManagerTokenSecret ?? "");
  const rootDir = String(c.woofx3RootPath ?? process.cwd());

  const messagebusUrl = String(c.woofx3MessagebusUrl ?? "ws://localhost:4225");
  const jwt = c.woofx3MessagebusJwt ? String(c.woofx3MessagebusJwt) : undefined;
  const nkeySeed = c.woofx3MessagebusNkey ? String(c.woofx3MessagebusNkey) : undefined;
  const token = nonBlank(c.woofx3MessagebusToken);

  const databaseProxyUrl = String(c.woofx3DatabaseProxyUrl ?? "");
  const dbProxyToken = String(c.woofx3DbProxyToken ?? "");
  const barkloaderUrl = String(c.woofx3BarkloaderUrl ?? "http://127.0.0.1:9653");
  const barkloaderKey = String(c.woofx3BarkloaderKey ?? "");
  const publicUrl = nonBlank(c.woofx3SceneManagerUrl);
  const requestGuard = parseRequestGuardPolicy({
    allowedHosts: c.woofx3AllowedHosts,
    allowedOrigins: c.woofx3AllowedOrigins,
    exposure: resolveExposure(bindHost, c.woofx3BehindEdge === true),
    ownUrls: publicUrl === undefined ? [] : [publicUrl],
    // Sandboxed widget frames load fonts and module scripts from sceneManager with `Origin: null`.
    extraDefaultOrigins: ["null", ...parseUiOrigins(c.woofx3UiUrl)],
  });

  return {
    port,
    bindHost,
    tokenSecret,
    rootDir,
    publicDir: resolvePublicDir(import.meta.dir),
    // The cache is written at runtime, so it follows the data directory when there is one.
    fontCacheDir: join(dataDir() ?? rootDir, "cache", "fonts"),
    databaseProxyUrl,
    dbProxyToken,
    barkloaderUrl,
    barkloaderKey,
    requestGuard,
    obsRefresh: {
      requestTimeoutMs: Number(c.woofx3SceneManagerObsRefreshRequestTimeoutMs),
      retryBaseMs: Number(c.woofx3SceneManagerObsRefreshRetryBaseMs),
      retryMaxMs: Number(c.woofx3SceneManagerObsRefreshRetryMaxMs),
      warnAfterAttempts: OBS_REFRESH_DEFAULTS.warnAfterAttempts,
    },
    nats: {
      url: messagebusUrl,
      name: "woofx3-scene-manager",
      jwt,
      nkeySeed,
      token,
    },
  };
}
