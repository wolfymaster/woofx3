export interface Clock {
  now(): number;
}

/** Uniform source in [0, 1), like Math.random. */
export interface RandomSource {
  next(): number;
}

export interface BackoffConfig {
  baseMs: number;
  maxMs: number;
}

export interface Backoff {
  /** Delay before the next retry; each call counts as one more failure. */
  next(): number;
  /** Forget past failures after a success. */
  reset(): void;
}

/**
 * Exponential backoff with full jitter: attempt n waits a uniform random delay in
 * [0, min(maxMs, baseMs * 2^n)). Once the ceiling reaches maxMs it stays there, so a long outage
 * never overflows the exponent or grows the wait past the cap.
 */
export function createBackoff(config: BackoffConfig, random: RandomSource): Backoff {
  if (!(config.baseMs > 0) || !(config.maxMs >= config.baseMs) || !Number.isFinite(config.maxMs)) {
    throw new Error(
      `backoff requires 0 < baseMs <= maxMs < Infinity, got baseMs=${config.baseMs} maxMs=${config.maxMs}`
    );
  }

  let ceilingMs = config.baseMs;

  return {
    next(): number {
      const sample = random.next();
      if (!(sample >= 0 && sample < 1)) {
        throw new Error(`RandomSource must return a value in [0, 1), got ${sample}`);
      }
      const delay = Math.floor(sample * ceilingMs);
      ceilingMs = Math.min(config.maxMs, ceilingMs * 2);
      return delay;
    },
    reset(): void {
      ceilingMs = config.baseMs;
    },
  };
}
