import { ENGINE_HOSTINGS, type EngineHosting, parseEngineHosting } from "@woofx3/api";
import { RELAY_DASHBOARD_REQUEST_TIMEOUT_MS } from "@woofx3/common/cloudevents/Relay/relay";
import { z } from "zod";

/**
 * Outstanding bridge tickets the relay allows per companion instance before it
 * answers 429 (MAX_TICKETS in woofx3-maintenance worker/src/relay/companion-relay.ts).
 */
export const RELAY_MAX_TICKETS = 16;

/**
 * How long a bridge ticket stays valid when the relay's answer does not say
 * (TICKET_TTL_MS in woofx3-maintenance worker/src/relay/companion-relay.ts).
 */
export const RELAY_TICKET_TTL_MS = 30_000;

/** Defaults for the companion gateway's tunables. */
export const COMPANION_DEFAULTS = {
  /**
   * Bridge opens (a ticket exchange and the upgrade it is spent on) in flight
   * across the whole companion gateway at once. Must stay at or below
   * RELAY_MAX_TICKETS, so the gateway answers `busy` itself before the relay
   * starts refusing tickets.
   */
  maxBridgeOpens: 8,
  /** One ticket exchange with the relay. */
  ticketTimeoutMs: 5_000,
  /**
   * One bridge credential request to the api, which asks the dashboard on the
   * gateway's behalf. Exceeds the api's own wait for the dashboard, so the
   * api's answer, a failure included, always arrives first. Not configurable
   * for that reason.
   */
  dashboardRequestTimeoutMs: RELAY_DASHBOARD_REQUEST_TIMEOUT_MS,
  /**
   * Whether module requests may dial a direct address on a `self` engine.
   * Off by default, like barkloader's WOOFX3_MODULE_HTTP_ALLOW_PRIVATE: a VPS
   * on a provider network would otherwise let module code reach that network.
   */
  moduleLocalDirect: false,
} as const;

/** Defaults for the websocket sessions the companion gateway holds for module requests. */
export const MODULE_SESSION_DEFAULTS = {
  /**
   * The longest a module request is served, from arrival. Below barkloader
   * ctx.local's 5_000 request timeout, so barkloader always gets an answer,
   * and the contract's budgetMs maximum.
   */
  requestBudgetMs: 4_500,
  /**
   * One session open: resolving the route (with the bridge's credential and
   * ticket exchange) and the upgrade. Independent of any call: a call whose
   * budget ends first is answered `unavailable` and the open carries on, so
   * the next call finds it.
   */
  openTimeoutMs: 10_000,
  /** One `.local` name lookup for a direct route, within openTimeoutMs. */
  resolveTimeoutMs: 3_000,
  /** A session nobody has used for this long is closed. */
  idleMs: 120_000,
  /**
   * Sessions open or opening at once. Bridge sessions are further limited by
   * maxBridgeOpens and the relay's RELAY_MAX_TICKETS.
   */
  maxSessions: 32,
  /** `request`s waiting for their matching frame on one session. */
  maxPendingPerSession: 16,
  /** The largest frame written or read, in UTF-8 bytes: the contract's message and reply bound. */
  maxMessageBytes: 65_536,
} as const;

export interface ModuleSessionLimits {
  requestBudgetMs: number;
  openTimeoutMs: number;
  resolveTimeoutMs: number;
  idleMs: number;
  maxSessions: number;
  maxPendingPerSession: number;
  maxMessageBytes: number;
}

// loadRuntimeEnv coerces all-digit values to numbers before the schema sees them.
// A blank WOOFX3_HOSTING means the deployment does not say, the same as unset.
const unsetWhenBlank = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);

export const CompanionEnvSchema = z.object({
  woofx3Hosting: z.preprocess(unsetWhenBlank, z.string().optional()),
  woofx3CompanionMaxBridgeOpens: z
    .number()
    .int()
    .min(1)
    .max(RELAY_MAX_TICKETS)
    .default(COMPANION_DEFAULTS.maxBridgeOpens),
  woofx3CompanionTicketTimeoutMs: z.number().int().positive().default(COMPANION_DEFAULTS.ticketTimeoutMs),
  woofx3ModuleLocalDirect: z.boolean().default(COMPANION_DEFAULTS.moduleLocalDirect),
});

export type CompanionEnv = z.infer<typeof CompanionEnvSchema>;

export interface CompanionConfig {
  /** How this engine is run (`WOOFX3_HOSTING`), or null when the deployment does not say. */
  hosting: EngineHosting | null;
  maxBridgeOpens: number;
  ticketTimeoutMs: number;
  dashboardRequestTimeoutMs: number;
  /** `WOOFX3_MODULE_LOCAL_DIRECT`: module requests may dial a direct address on a `self` engine. */
  moduleLocalDirect: boolean;
  moduleSessions: ModuleSessionLimits;
}

/** Rules the per-key schema cannot express. */
export function companionConfigProblems(env: CompanionEnv): string[] {
  const problems: string[] = [];
  const hosting = env.woofx3Hosting?.trim();
  if (hosting !== undefined && parseEngineHosting(hosting) === null) {
    problems.push(`woofx3Hosting must be one of ${ENGINE_HOSTINGS.join(", ")}, got ${hosting}`);
  }
  return problems;
}

/** Shapes the validated env; `companionConfigProblems` has already refused a bad hosting value. */
export function companionConfig(env: CompanionEnv): CompanionConfig {
  const raw = env.woofx3Hosting?.trim();
  const hosting = raw === undefined ? null : parseEngineHosting(raw);
  if (raw !== undefined && hosting === null) {
    throw new Error(`woofx3Hosting must be one of ${ENGINE_HOSTINGS.join(", ")}, got ${raw}`);
  }
  return {
    hosting,
    maxBridgeOpens: env.woofx3CompanionMaxBridgeOpens,
    ticketTimeoutMs: env.woofx3CompanionTicketTimeoutMs,
    dashboardRequestTimeoutMs: COMPANION_DEFAULTS.dashboardRequestTimeoutMs,
    moduleLocalDirect: env.woofx3ModuleLocalDirect,
    moduleSessions: { ...MODULE_SESSION_DEFAULTS },
  };
}
