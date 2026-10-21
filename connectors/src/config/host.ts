import { z } from "zod";

/**
 * Defaults for the host's tunables. Each served subject declares its own reply
 * budget next to its adapter, so there is no host-wide one here.
 */
export const HOST_DEFAULTS = {
  /** Loopback port of GET /health (docs/services/connectors.md). */
  port: 9102,
  /** Backstop: links are re-read this often even when no settings event arrives. */
  reconcileIntervalMs: 60_000,
  backoffBaseMs: 1_000,
  backoffMaxMs: 300_000,
  /** This many failed starts or faults within the window parks an adapter until its settings change. */
  parkAfterFailures: 5,
  parkWindowMs: 600_000,
  /** How long one adapter's stop may take before it is marked stopped anyway. */
  stopDeadlineMs: 10_000,
  /** Handlers one subscription runs at once, and messages it queues behind them before dropping. */
  adapterConcurrency: 16,
  adapterQueueCap: 256,
  /** Whole-process shutdown, after which the process exits 1. Must leave room for stopDeadlineMs. */
  shutdownDeadlineMs: 15_000,
} as const;

/**
 * The runtime's heartbeat and liveness publishes. Not configurable: they match
 * the other Bun services, which every bus consumer already expects.
 */
export const RUNTIME_HEARTBEAT_INTERVAL_MS = 250_000;
export const RUNTIME_LIVENESS_INTERVAL_MS = 300_000;

const positiveMs = z.number().int().positive();

// loadRuntimeEnv coerces all-digit values to numbers before the schema sees them.
export const HostEnvSchema = z.object({
  woofx3ConnectorsPort: z.number().int().min(1).max(65_535).default(HOST_DEFAULTS.port),
  woofx3ConnectorsReconcileIntervalMs: positiveMs.default(HOST_DEFAULTS.reconcileIntervalMs),
  woofx3ConnectorsBackoffBaseMs: positiveMs.default(HOST_DEFAULTS.backoffBaseMs),
  woofx3ConnectorsBackoffMaxMs: positiveMs.default(HOST_DEFAULTS.backoffMaxMs),
  woofx3ConnectorsParkAfterFailures: z.number().int().positive().default(HOST_DEFAULTS.parkAfterFailures),
  woofx3ConnectorsParkWindowMs: positiveMs.default(HOST_DEFAULTS.parkWindowMs),
  woofx3ConnectorsStopDeadlineMs: positiveMs.default(HOST_DEFAULTS.stopDeadlineMs),
  woofx3ConnectorsAdapterConcurrency: z.number().int().positive().default(HOST_DEFAULTS.adapterConcurrency),
  woofx3ConnectorsAdapterQueueCap: z.number().int().nonnegative().default(HOST_DEFAULTS.adapterQueueCap),
  woofx3ConnectorsShutdownDeadlineMs: positiveMs.default(HOST_DEFAULTS.shutdownDeadlineMs),
});

export type HostEnv = z.infer<typeof HostEnvSchema>;

export interface HostConfig {
  port: number;
  reconcileIntervalMs: number;
  backoff: { baseMs: number; maxMs: number };
  park: { afterFailures: number; windowMs: number };
  stopDeadlineMs: number;
  subscriptionLimits: { concurrency: number; queueCap: number };
  shutdownDeadlineMs: number;
}

/** Cross-field rules the per-key schema cannot express. Returns one message per broken rule. */
export function hostConfigProblems(env: HostEnv): string[] {
  const problems: string[] = [];
  if (env.woofx3ConnectorsBackoffBaseMs > env.woofx3ConnectorsBackoffMaxMs) {
    problems.push(
      `woofx3ConnectorsBackoffBaseMs (${env.woofx3ConnectorsBackoffBaseMs}) must not exceed woofx3ConnectorsBackoffMaxMs (${env.woofx3ConnectorsBackoffMaxMs})`
    );
  }
  // Shutdown stops every adapter in parallel, each under stopDeadlineMs, so a
  // shutdown deadline at or below it would cut off a stop still in its allowance.
  if (env.woofx3ConnectorsShutdownDeadlineMs <= env.woofx3ConnectorsStopDeadlineMs) {
    problems.push(
      `woofx3ConnectorsShutdownDeadlineMs (${env.woofx3ConnectorsShutdownDeadlineMs}) must exceed woofx3ConnectorsStopDeadlineMs (${env.woofx3ConnectorsStopDeadlineMs})`
    );
  }
  return problems;
}

export function hostConfig(env: HostEnv): HostConfig {
  return {
    port: env.woofx3ConnectorsPort,
    reconcileIntervalMs: env.woofx3ConnectorsReconcileIntervalMs,
    backoff: { baseMs: env.woofx3ConnectorsBackoffBaseMs, maxMs: env.woofx3ConnectorsBackoffMaxMs },
    park: { afterFailures: env.woofx3ConnectorsParkAfterFailures, windowMs: env.woofx3ConnectorsParkWindowMs },
    stopDeadlineMs: env.woofx3ConnectorsStopDeadlineMs,
    subscriptionLimits: {
      concurrency: env.woofx3ConnectorsAdapterConcurrency,
      queueCap: env.woofx3ConnectorsAdapterQueueCap,
    },
    shutdownDeadlineMs: env.woofx3ConnectorsShutdownDeadlineMs,
  };
}
