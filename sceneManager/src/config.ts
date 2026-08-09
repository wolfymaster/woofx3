import { loadRuntimeEnv } from "@woofx3/common/runtime";
import { z } from "zod";

export const SceneManagerEnvSchema = z.object({
  woofx3SceneManagerPort: z.union([z.number(), z.string()]).default("9101"),
  sceneManagerPort: z.union([z.number(), z.string()]).optional(),
  // sceneManager binds loopback by default, same convention streamware
  // used — a reverse proxy (or direct exposure in dev) is the public
  // surface, never assumed here.
  woofx3SceneManagerHost: z.string().default("127.0.0.1"),
  sceneManagerHost: z.string().optional(),
  // This deployment's public base URL — used when building the widget
  // frame's session cookie domain and any absolute URLs sceneManager
  // itself needs to hand out (e.g. to Convex). No hardcoded guess
  // beyond the env/config value (same convention as barkloader's
  // storage.publicUrl / streamware's overlay.publicUrl).
  woofx3SceneManagerUrl: z.string().optional(),
  sceneManagerUrl: z.string().optional(),
  // HS256 signing secret for the short-lived session JWT minted at
  // `GET /scene/{sceneId}`. Required — fail fast rather than run with
  // an absent/guessable secret.
  woofx3SceneManagerTokenSecret: z.string().optional(),
  sceneManagerTokenSecret: z.string().optional(),
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
  // Barkloader is a server-to-server dependency now (frame entry HTML +
  // resource base URL resolution) — never the source of directly
  // browser-fetched asset bytes (those hit barkloader's own public URL
  // — see barkloader's storage.publicUrl — not sceneManager).
  woofx3BarkloaderUrl: z.string().default("http://127.0.0.1:9653"),
  barkloaderUrl: z.string().optional(),
});

export type SceneManagerConfig = z.infer<typeof SceneManagerEnvSchema>;

export interface SceneManagerRuntimeConfig {
  port: number;
  bindHost: string;
  publicUrl: string;
  tokenSecret: string;
  rootDir: string;
  publicDir: string;
  databaseProxyUrl: string;
  barkloaderUrl: string;
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

/**
 * Fail-fast validation, same spirit as streamware's
 * `validateOverlayConfig`: assert the invariants the rest of the
 * service depends on at startup rather than surfacing them as
 * confusing runtime failures later.
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
  try {
    new URL(config.barkloaderUrl);
  } catch {
    throw new Error(`sceneManager: barkloaderUrl is not a valid URL: ${config.barkloaderUrl}`);
  }
  if (config.publicUrl) {
    try {
      new URL(config.publicUrl);
    } catch {
      throw new Error(`sceneManager: publicUrl is not a valid URL: ${config.publicUrl}`);
    }
  }
}

export function loadConfig(): SceneManagerRuntimeConfig {
  const result = loadRuntimeEnv({ injectIntoProcess: true, schema: SceneManagerEnvSchema });
  const c = result.config;

  const port = Number(c.woofx3SceneManagerPort ?? c.sceneManagerPort ?? 9101);
  const bindHost = String(c.woofx3SceneManagerHost ?? c.sceneManagerHost ?? "127.0.0.1");
  const publicUrl = String(c.woofx3SceneManagerUrl ?? c.sceneManagerUrl ?? "");
  const tokenSecret = String(c.woofx3SceneManagerTokenSecret ?? c.sceneManagerTokenSecret ?? "");
  const rootDir = String(c.woofx3RootPath ?? c.rootPath ?? process.cwd());

  const messagebusUrl = String(c.woofx3MessagebusUrl ?? c.messagebusUrl ?? "ws://localhost:4225");
  const jwt = c.woofx3MessagebusJwt ? String(c.woofx3MessagebusJwt) : c.messagebusJwt ? String(c.messagebusJwt) : undefined;
  const nkeySeed = c.woofx3MessagebusNkey
    ? String(c.woofx3MessagebusNkey)
    : c.messagebusNkey
      ? String(c.messagebusNkey)
      : undefined;

  const obsHost = String(c.woofx3ObsHost ?? c.obsHost ?? "127.0.0.1");
  const obsPort = String(c.woofx3ObsPort ?? c.obsPort ?? "4455");
  const obsToken = c.woofx3ObsRpcToken ? String(c.woofx3ObsRpcToken) : c.obsRpcToken ? String(c.obsRpcToken) : undefined;

  const databaseProxyUrl = String(c.woofx3DatabaseProxyUrl ?? c.databaseProxyUrl ?? "");
  const barkloaderUrl = String(c.woofx3BarkloaderUrl ?? c.barkloaderUrl ?? "http://127.0.0.1:9653");

  return {
    port,
    bindHost,
    publicUrl,
    tokenSecret,
    rootDir,
    publicDir: `${import.meta.dir}/../public`,
    databaseProxyUrl,
    barkloaderUrl,
    obs: {
      url: `ws://${obsHost}:${obsPort}`,
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
