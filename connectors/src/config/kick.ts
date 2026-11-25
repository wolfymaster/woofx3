import { z } from "zod";

/** Defaults for the Kick adapter's tunables. */
export const KICK_DEFAULTS = {
  /** Kick's public API, from https://docs.kick.com. A test points it at a fake Kick server. */
  apiBaseUrl: "https://api.kick.com",
  /**
   * Sent on every request: Cloudflare in front of api.kick.com refuses bare
   * HTTP clients (error 1010).
   */
  userAgent: "woofx3-connectors (+https://woofx3.tv)",
  /** How long one Kick call may wait for its answer. Under the platform gateway's deadline (config/gateway.ts). */
  requestTimeoutMs: 8_000,
  /** How long one `engine.kick.token` request may wait on the api, which may ask the dashboard (5 s). */
  tokenRequestTimeoutMs: 7_000,
  /** A token this close to its expiry is asked for again rather than used. */
  tokenExpiryMarginMs: 60_000,
  /**
   * How far a delivery's timestamp may be from the clock. Kick does not
   * document its retry timing, so the window is wide enough to accept its
   * retries; deduplication, not this window, stops a replay inside it.
   */
  webhookMaxSkewMs: 60 * 60_000,
  /** How long a delivery id is remembered as published. Must exceed `webhookMaxSkewMs`. */
  dedupeTtlMs: 2 * 60 * 60_000,
  /** Cap on remembered delivery ids, so a burst cannot grow the memory without bound. */
  dedupeMaxEntries: 100_000,
  /** How long a redemption id is remembered as published, so its later status updates publish nothing. */
  redemptionSeenTtlMs: 24 * 60 * 60_000,
  redemptionSeenMaxEntries: 10_000,
  /** Kick rotates its webhook key without a key id; a failed check refetches it at most this often. */
  publicKeyRefetchMinIntervalMs: 60_000,
  /** How often the event subscriptions are checked, so one Kick dropped is recreated. */
  subscriptionReconcileIntervalMs: 15 * 60_000,
  /** The subscription check's backoff after a failed pass: jittered, doubling from base to max. */
  reconcileBackoff: { baseMs: 30_000, maxMs: 15 * 60_000 },
  /** How many chat and moderation writes may wait behind the one being sent; see TWITCH_DEFAULTS.sendQueueCap. */
  sendQueueCap: 100,
  /** How many of the engine's own chat lines are remembered while their webhook echo is awaited. */
  selfSentCapacity: 256,
  /** How long an own line waits for its echo. */
  selfSentTtlMs: 30_000,
} as const;

// loadRuntimeEnv coerces env strings to numbers before the schema sees them.
export const KickEnvSchema = z.object({
  woofx3KickSendQueueCap: z.number().int().nonnegative().default(KICK_DEFAULTS.sendQueueCap),
  woofx3KickSelfSentCapacity: z.number().int().positive().default(KICK_DEFAULTS.selfSentCapacity),
  woofx3KickSelfSentTtlMs: z.number().int().positive().default(KICK_DEFAULTS.selfSentTtlMs),
});

export type KickEnv = z.infer<typeof KickEnvSchema>;

export interface KickConfig {
  apiBaseUrl: string;
  userAgent: string;
  requestTimeoutMs: number;
  tokenRequestTimeoutMs: number;
  tokenExpiryMarginMs: number;
  webhookMaxSkewMs: number;
  dedupe: { ttlMs: number; capacity: number };
  redemptionSeen: { ttlMs: number; capacity: number };
  publicKeyRefetchMinIntervalMs: number;
  subscriptionReconcileIntervalMs: number;
  reconcileBackoff: { baseMs: number; maxMs: number };
  sendQueueCap: number;
  selfSent: { capacity: number; ttlMs: number };
}

export function kickConfig(env: KickEnv): KickConfig {
  if (KICK_DEFAULTS.dedupeTtlMs <= KICK_DEFAULTS.webhookMaxSkewMs) {
    throw new Error(
      "KICK_DEFAULTS.dedupeTtlMs must exceed webhookMaxSkewMs, or a retry inside the window publishes again"
    );
  }
  return {
    apiBaseUrl: KICK_DEFAULTS.apiBaseUrl,
    userAgent: KICK_DEFAULTS.userAgent,
    requestTimeoutMs: KICK_DEFAULTS.requestTimeoutMs,
    tokenRequestTimeoutMs: KICK_DEFAULTS.tokenRequestTimeoutMs,
    tokenExpiryMarginMs: KICK_DEFAULTS.tokenExpiryMarginMs,
    webhookMaxSkewMs: KICK_DEFAULTS.webhookMaxSkewMs,
    dedupe: { ttlMs: KICK_DEFAULTS.dedupeTtlMs, capacity: KICK_DEFAULTS.dedupeMaxEntries },
    redemptionSeen: { ttlMs: KICK_DEFAULTS.redemptionSeenTtlMs, capacity: KICK_DEFAULTS.redemptionSeenMaxEntries },
    publicKeyRefetchMinIntervalMs: KICK_DEFAULTS.publicKeyRefetchMinIntervalMs,
    subscriptionReconcileIntervalMs: KICK_DEFAULTS.subscriptionReconcileIntervalMs,
    reconcileBackoff: KICK_DEFAULTS.reconcileBackoff,
    sendQueueCap: env.woofx3KickSendQueueCap,
    selfSent: { capacity: env.woofx3KickSelfSentCapacity, ttlMs: env.woofx3KickSelfSentTtlMs },
  };
}
