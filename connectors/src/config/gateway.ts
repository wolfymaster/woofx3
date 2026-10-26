import { CALLER_TIMEOUT_MS } from "@woofx3/api/platform-gateway";
import { z } from "zod";

export const GATEWAY_DEFAULTS = {
  /**
   * Budget of one platform.gateway.send request, and so of every platform it
   * fans out to. Above the Twitch adapter's Helix deadline (8_000), so an
   * adapter reports its own timeout first, and below the contract's
   * CALLER_TIMEOUT_MS, which the schema enforces so a caller always gets the
   * per-platform results, never a timeout.
   */
  adapterDeadlineMs: 9_000,
  /**
   * Budget of both discovery subjects. They only read in-memory state, so this
   * is far below the callers' own timeouts (the api waits 10_000 for field
   * options) and only bounds a request that queued behind busy handlers.
   */
  discoveryBudgetMs: 2_000,
  /** Completed replies remembered for replay, oldest evicted first. */
  idempotencyCapacity: 1_024,
  /** How long a completed reply is replayed for a repeated idempotency key. */
  idempotencyTtlMs: 600_000,
} as const;

// loadRuntimeEnv coerces all-digit values to numbers before the schema sees them.
export const GatewayEnvSchema = z.object({
  woofx3ConnectorsGatewayAdapterDeadlineMs: z
    .number()
    .int()
    .positive()
    .lt(CALLER_TIMEOUT_MS)
    .default(GATEWAY_DEFAULTS.adapterDeadlineMs),
  woofx3ConnectorsGatewayIdempotencyCapacity: z.number().int().positive().default(GATEWAY_DEFAULTS.idempotencyCapacity),
  woofx3ConnectorsGatewayIdempotencyTtlMs: z.number().int().positive().default(GATEWAY_DEFAULTS.idempotencyTtlMs),
});

export type GatewayEnv = z.infer<typeof GatewayEnvSchema>;

export interface GatewayConfig {
  adapterDeadlineMs: number;
  /** Budget of each discovery request (capabilities, field options). */
  discoveryBudgetMs: number;
  idempotency: { capacity: number; ttlMs: number };
}

export function gatewayConfig(env: GatewayEnv): GatewayConfig {
  return {
    adapterDeadlineMs: env.woofx3ConnectorsGatewayAdapterDeadlineMs,
    discoveryBudgetMs: GATEWAY_DEFAULTS.discoveryBudgetMs,
    idempotency: {
      capacity: env.woofx3ConnectorsGatewayIdempotencyCapacity,
      ttlMs: env.woofx3ConnectorsGatewayIdempotencyTtlMs,
    },
  };
}
