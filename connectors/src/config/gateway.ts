import { z } from "zod";

/**
 * How long the platform gateway's callers wait for a reply
 * (docs/services/platform-gateway.md). The gateway's deadline must stay
 * below it so a caller always gets the per-platform results, never a timeout.
 */
export const GATEWAY_CALLER_TIMEOUT_MS = 12_000;

export const GATEWAY_DEFAULTS = {
  /**
   * Budget of one platform.gateway.send request, and so of every platform it
   * fans out to. Above the Twitch adapter's Helix deadline (8_000), so an
   * adapter reports its own timeout first, and below the callers' 12_000.
   */
  adapterDeadlineMs: 9_000,
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
    .lt(GATEWAY_CALLER_TIMEOUT_MS)
    .default(GATEWAY_DEFAULTS.adapterDeadlineMs),
  woofx3ConnectorsGatewayIdempotencyCapacity: z.number().int().positive().default(GATEWAY_DEFAULTS.idempotencyCapacity),
  woofx3ConnectorsGatewayIdempotencyTtlMs: z.number().int().positive().default(GATEWAY_DEFAULTS.idempotencyTtlMs),
});

export type GatewayEnv = z.infer<typeof GatewayEnvSchema>;

export interface GatewayConfig {
  adapterDeadlineMs: number;
  idempotency: { capacity: number; ttlMs: number };
}

export function gatewayConfig(env: GatewayEnv): GatewayConfig {
  return {
    adapterDeadlineMs: env.woofx3ConnectorsGatewayAdapterDeadlineMs,
    idempotency: {
      capacity: env.woofx3ConnectorsGatewayIdempotencyCapacity,
      ttlMs: env.woofx3ConnectorsGatewayIdempotencyTtlMs,
    },
  };
}
