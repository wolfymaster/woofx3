import { z } from "zod";
import type { ObsFallback } from "../adapters/obs/settings";

/** Where OBS is looked for when the OBS module's settings leave a value empty (adapters/obs/settings.ts). */
export const OBS_DEFAULTS = {
  host: "127.0.0.1",
  /** obs-websocket's own default port. */
  port: 4455,
} as const;

/**
 * The host's reply budget per OBS subject. Each sits below the timeout its
 * callers wait, so a caller always gets the adapter's answer or the host's
 * unavailable reply, never a timeout. Not configurable: the callers' timeouts
 * are fixed in their own code.
 */
export const OBS_SERVED_BUDGETS_MS = {
  /** Below barkloader ctx.obs's 5_000 (lib_sandbox/src/extensions/obs.rs); above OBS_COMMAND_TIMEOUT_MS (3_500). */
  command: 4_500,
  /** Same callers and limits as command. */
  options: 4_500,
  /** Below the api's OBS_STATUS_TIMEOUT_MS (3_000, api/src/routes/obs.ts). */
  status: 2_500,
  /** Below sceneManager's WOOFX3_SCENE_MANAGER_OBS_REFRESH_REQUEST_TIMEOUT_MS default (2_000); it retries a timeout. */
  refresh: 1_500,
} as const;

// loadRuntimeEnv coerces all-digit values to numbers before the schema sees
// them, so a numeric password arrives as a number and is turned back into text.
export const ObsEnvSchema = z.object({
  woofx3ObsHost: z.string().default(OBS_DEFAULTS.host),
  woofx3ObsPort: z.number().int().min(1).max(65_535).default(OBS_DEFAULTS.port),
  woofx3ObsRpcToken: z.union([z.string(), z.number()]).optional(),
});

export type ObsEnv = z.infer<typeof ObsEnvSchema>;

export type ObsConfig = ObsFallback;

export function obsConfig(env: ObsEnv): ObsConfig {
  const host = env.woofx3ObsHost.trim();
  const token = env.woofx3ObsRpcToken === undefined ? "" : String(env.woofx3ObsRpcToken).trim();
  return {
    host: host === "" ? OBS_DEFAULTS.host : host,
    port: String(env.woofx3ObsPort),
    token: token === "" ? undefined : token,
  };
}
