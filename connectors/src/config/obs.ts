import type { BackoffConfig } from "@woofx3/common/runtime";
import { z } from "zod";
import type { ObsFallback } from "../adapters/obs/settings";
import { COMPANION_DEFAULTS } from "./companion";
import { unsetWhenBlank } from "./env";

/** Defaults for the OBS adapter's connection and tunables. */
export const OBS_DEFAULTS = {
  /** Where OBS is looked for when the OBS module's settings leave the host empty (adapters/obs/settings.ts). */
  host: "127.0.0.1",
  /** obs-websocket's own default port. */
  port: 4455,
  /** First retry ceiling after OBS could not be reached; it doubles per failure up to backoffMaxMs. */
  backoffInitialMs: 1_000,
  backoffMaxMs: 30_000,
  /** One WebSocket handshake with OBS. obs-websocket-js sets no deadline of its own on a stalled one. */
  connectTimeoutMs: 3_000,
  /**
   * One attempt to open a session, from dialing to a client ready for
   * requests. Through the companion it covers the relay credential request
   * and the ticket exchange (COMPANION_DEFAULTS in config/companion.ts, which
   * checks the sum) and the WebSocket upgrade, so it must exceed their sum.
   */
  openTimeoutMs: 15_000,
  /** One command or listing in OBS. Below OBS_SERVED_BUDGETS_MS.command, so the caller gets the adapter's reason. */
  commandTimeoutMs: 3_500,
} as const;

/**
 * The host's reply budget per OBS subject. Each sits below the timeout its
 * callers wait, so a caller always gets the adapter's answer or the host's
 * unavailable reply, never a timeout. Not configurable: the callers' timeouts
 * are fixed in their own code.
 */
export const OBS_SERVED_BUDGETS_MS = {
  /** Below barkloader ctx.obs's 5_000 (lib_sandbox/src/extensions/obs.rs); above the command timeout. */
  command: 4_500,
  /** Same callers and limits as command. */
  options: 4_500,
  /** Below the api's OBS_STATUS_TIMEOUT_MS (3_000, api/src/routes/obs.ts). */
  status: 2_500,
  /** Below sceneManager's WOOFX3_SCENE_MANAGER_OBS_REFRESH_REQUEST_TIMEOUT_MS default (2_000); it retries a timeout. */
  refresh: 1_500,
} as const;

const positiveMs = z.number().int().positive();

// loadRuntimeEnv coerces all-digit values to numbers before the schema sees
// them, so a numeric password arrives as a number and is turned back into text.
// A blank value means "unset" for the host, port and password: the default applies.
export const ObsEnvSchema = z.object({
  // No default here: whether the host was set at all decides if OBS runs
  // without an OBS module (obsConfig's hostExplicit).
  woofx3ObsHost: z.string().optional(),
  woofx3ObsPort: z.preprocess(unsetWhenBlank, z.number().int().min(1).max(65_535).default(OBS_DEFAULTS.port)),
  woofx3ObsRpcToken: z.union([z.string(), z.number()]).optional(),
  woofx3ObsBackoffInitialMs: positiveMs.default(OBS_DEFAULTS.backoffInitialMs),
  woofx3ObsBackoffMaxMs: positiveMs.default(OBS_DEFAULTS.backoffMaxMs),
  woofx3ObsConnectTimeoutMs: positiveMs.default(OBS_DEFAULTS.connectTimeoutMs),
  woofx3ObsOpenTimeoutMs: positiveMs.default(OBS_DEFAULTS.openTimeoutMs),
  woofx3ObsCommandTimeoutMs: positiveMs.default(OBS_DEFAULTS.commandTimeoutMs),
});

export type ObsEnv = z.infer<typeof ObsEnvSchema>;

/** How the adapter keeps its OBS session open. */
export interface ObsConnectionConfig {
  backoff: BackoffConfig;
  connectTimeoutMs: number;
  openTimeoutMs: number;
}

export interface ObsConfig {
  /** Where OBS is when the OBS module's settings leave a value empty. */
  fallback: ObsFallback;
  /**
   * WOOFX3_OBS_HOST holds a value. The adapter then runs without any OBS
   * module installed, for an engine that is pointed at OBS by configuration.
   */
  hostExplicit: boolean;
  connection: ObsConnectionConfig;
  /** How long one command or listing may take in OBS before the session is recycled. */
  commandTimeoutMs: number;
}

/**
 * Cross-field rules the per-key schema cannot express. Returns one message per broken rule.
 * An open through the companion asks for the bridge credential and exchanges a
 * ticket before it upgrades, all inside the open deadline.
 */
export function obsConfigProblems(env: ObsEnv & { woofx3CompanionTicketTimeoutMs: number }): string[] {
  const problems: string[] = [];
  if (env.woofx3ObsBackoffInitialMs > env.woofx3ObsBackoffMaxMs) {
    problems.push(
      `woofx3ObsBackoffInitialMs (${env.woofx3ObsBackoffInitialMs}) must not exceed woofx3ObsBackoffMaxMs (${env.woofx3ObsBackoffMaxMs})`
    );
  }
  if (env.woofx3ObsConnectTimeoutMs >= env.woofx3ObsOpenTimeoutMs) {
    problems.push(
      `woofx3ObsConnectTimeoutMs (${env.woofx3ObsConnectTimeoutMs}) must be below woofx3ObsOpenTimeoutMs (${env.woofx3ObsOpenTimeoutMs}), which includes it`
    );
  }
  const bridgeSetupMs = COMPANION_DEFAULTS.dashboardRequestTimeoutMs + env.woofx3CompanionTicketTimeoutMs;
  if (env.woofx3ObsOpenTimeoutMs <= bridgeSetupMs) {
    problems.push(
      `woofx3ObsOpenTimeoutMs (${env.woofx3ObsOpenTimeoutMs}) must exceed the bridge credential request (${COMPANION_DEFAULTS.dashboardRequestTimeoutMs}) plus woofx3CompanionTicketTimeoutMs (${env.woofx3CompanionTicketTimeoutMs}), which an open through the companion includes`
    );
  }
  // Options share the command budget; both are checked through the smaller.
  const servedBudgetMs = Math.min(OBS_SERVED_BUDGETS_MS.command, OBS_SERVED_BUDGETS_MS.options);
  if (env.woofx3ObsCommandTimeoutMs >= servedBudgetMs) {
    problems.push(
      `woofx3ObsCommandTimeoutMs (${env.woofx3ObsCommandTimeoutMs}) must be below the OBS command reply budget (${servedBudgetMs})`
    );
  }
  return problems;
}

export function obsConfig(env: ObsEnv): ObsConfig {
  const host = env.woofx3ObsHost?.trim() ?? "";
  const token = env.woofx3ObsRpcToken === undefined ? "" : String(env.woofx3ObsRpcToken).trim();
  return {
    fallback: {
      host: host === "" ? OBS_DEFAULTS.host : host,
      port: String(env.woofx3ObsPort),
      token: token === "" ? undefined : token,
    },
    hostExplicit: host !== "",
    connection: {
      backoff: { baseMs: env.woofx3ObsBackoffInitialMs, maxMs: env.woofx3ObsBackoffMaxMs },
      connectTimeoutMs: env.woofx3ObsConnectTimeoutMs,
      openTimeoutMs: env.woofx3ObsOpenTimeoutMs,
    },
    commandTimeoutMs: env.woofx3ObsCommandTimeoutMs,
  };
}
