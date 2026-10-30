/**
 * The limits on browser pairing (see pairing.ts and docs/services/pairing.md).
 * Each one bounds what an unauthenticated caller can make the engine hold or
 * do, so none can be switched off.
 */
export interface PairingConfig {
  /** How long a pairing waits for a decision and a claim, in milliseconds. */
  ttlMs: number;
  /** The interval a browser is told to poll `claimPairing` at, in milliseconds (RFC 8628's default). */
  pollIntervalMs: number;
  /** What a `slow_down` adds to that interval, in milliseconds (RFC 8628). */
  slowDownStepMs: number;
  /** Pairings waiting at once, across every origin: the bound on memory and on approver noise. */
  maxPending: number;
  /** Pairings waiting at once from one origin, so one origin cannot fill `maxPending`. */
  maxPendingPerOrigin: number;
  /** Pairings one origin may start in a minute. */
  startsPerOriginPerMinute: number;
  /** Pairings every origin together may start in a minute; a non-browser caller can forge `Origin`. */
  startsPerMinute: number;
  /**
   * Pairings one peer address may start in a minute, whatever `Origin` it
   * sends. The address is the one the server sees: behind a reverse proxy
   * every browser shares the proxy's, and the limit applies to them together.
   */
  startsPerAddressPerMinute: number;
  /** Claims or cancels with a wrong verifier, from the pairing's own origin, that end a pairing. */
  claimFailuresBeforeCancel: number;
  /** Denied pairings remembered so their browsers learn of the denial; the oldest is forgotten first. */
  maxDeniedRemembered: number;
}

export const DEFAULT_PAIRING_CONFIG: PairingConfig = {
  ttlMs: 10 * 60_000,
  pollIntervalMs: 5_000,
  slowDownStepMs: 5_000,
  maxPending: 5,
  maxPendingPerOrigin: 2,
  startsPerOriginPerMinute: 6,
  startsPerMinute: 20,
  startsPerAddressPerMinute: 10,
  claimFailuresBeforeCancel: 3,
  maxDeniedRemembered: 20,
};

/** Throws, naming the field, when a limit is not a positive integer or the limits contradict each other. */
export function validatePairingConfig(config: PairingConfig): PairingConfig {
  for (const [name, value] of Object.entries(config)) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`PairingConfig.${name} must be a positive integer, got ${value}`);
    }
  }
  if (config.maxPendingPerOrigin > config.maxPending) {
    throw new Error(
      `PairingConfig.maxPendingPerOrigin (${config.maxPendingPerOrigin}) exceeds maxPending (${config.maxPending})`
    );
  }
  if (config.startsPerAddressPerMinute > config.startsPerMinute) {
    throw new Error(
      `PairingConfig.startsPerAddressPerMinute (${config.startsPerAddressPerMinute}) exceeds startsPerMinute (${config.startsPerMinute})`
    );
  }
  if (config.startsPerOriginPerMinute > config.startsPerMinute) {
    throw new Error(
      `PairingConfig.startsPerOriginPerMinute (${config.startsPerOriginPerMinute}) exceeds startsPerMinute (${config.startsPerMinute})`
    );
  }
  return config;
}
