import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadRuntimeEnv } from "@woofx3/common/runtime";
import { WIDGET_HOST_SHIM_FILE } from "@woofx3/widget-host/frame";
import { z } from "zod";

export const SceneManagerEnvSchema = z.object({
  woofx3SceneManagerPort: z.union([z.number(), z.string()]).default("9101"),
  // sceneManager binds loopback by default: a reverse proxy (or direct
  // exposure in dev) is the public surface, never assumed here.
  woofx3SceneManagerHost: z.string().default("127.0.0.1"),
  // HS256 signing secret for the short-lived session JWT minted at
  // `GET /scene/{sceneId}`. Required — fail fast rather than run with
  // an absent/guessable secret.
  woofx3SceneManagerTokenSecret: z.string().optional(),
  woofx3RootPath: z.string().optional(),
  woofx3MessagebusUrl: z.string().default("ws://localhost:4225"),
  woofx3MessagebusJwt: z.string().optional(),
  woofx3MessagebusNkey: z.string().optional(),
  woofx3ObsHost: z.string().default("127.0.0.1"),
  woofx3ObsPort: z.union([z.number(), z.string()]).default("4455"),
  woofx3ObsRpcToken: z.string().optional(),
  woofx3DatabaseProxyUrl: z.string().default(""),
  woofx3BarkloaderUrl: z.string().default("http://127.0.0.1:9653"),
  // The engine secret barkloader verifies media proxy URLs with (see
  // scene/media-proxy.ts); sceneManager signs them with it.
  woofx3BarkloaderKey: z.string().optional(),
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
  barkloaderUrl: string;
  /** Signs the media proxy URLs barkloader verifies (scene/media-proxy.ts). */
  mediaProxySecret: string;
  /**
   * Where OBS is when the OBS module's settings do not say (obs/settings.ts):
   * the module is not installed, or a setting is empty.
   */
  obs: {
    host: string;
    port: string;
    token?: string;
  };
  nats: {
    url: string;
    name: string;
    jwt?: string;
    nkeySeed?: string;
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
  if (!config.tokenSecret) {
    throw new Error(
      "sceneManager: tokenSecret is required (WOOFX3_SCENE_MANAGER_TOKEN_SECRET) — refusing to mint session tokens with no secret"
    );
  }
  if (!config.barkloaderUrl) {
    throw new Error("sceneManager: barkloaderUrl must not be empty (WOOFX3_BARKLOADER_URL)");
  }
  if (!config.mediaProxySecret) {
    throw new Error(
      "sceneManager: barkloaderKey is required (WOOFX3_BARKLOADER_KEY) — external media in widget settings is signed with it"
    );
  }
  try {
    new URL(config.barkloaderUrl);
  } catch {
    throw new Error(`sceneManager: barkloaderUrl is not a valid URL: ${config.barkloaderUrl}`);
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

  const obsHost = String(c.woofx3ObsHost ?? "127.0.0.1");
  const obsPort = String(c.woofx3ObsPort ?? "4455");
  const obsToken = c.woofx3ObsRpcToken ? String(c.woofx3ObsRpcToken) : undefined;

  const databaseProxyUrl = String(c.woofx3DatabaseProxyUrl ?? "");
  const barkloaderUrl = String(c.woofx3BarkloaderUrl ?? "http://127.0.0.1:9653");
  const mediaProxySecret = String(c.woofx3BarkloaderKey ?? "");

  return {
    port,
    bindHost,
    tokenSecret,
    rootDir,
    publicDir: resolvePublicDir(import.meta.dir),
    fontCacheDir: join(rootDir, "cache", "fonts"),
    databaseProxyUrl,
    barkloaderUrl,
    mediaProxySecret,
    obs: {
      host: obsHost,
      port: obsPort,
      token: obsToken,
    },
    nats: {
      url: messagebusUrl,
      name: "woofx3-scene-manager",
      jwt,
      nkeySeed,
    },
  };
}
