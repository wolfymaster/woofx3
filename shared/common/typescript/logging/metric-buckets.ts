/**
 * Explicit histogram boundaries, in seconds. The SDK defaults (0, 5, 10, 25 ...
 * 10000) are tuned for milliseconds and would put every seconds-valued
 * observation in the first bucket or two.
 */

/** Work expected to finish in well under a second: a step, a handler, an RPC. */
export const SHORT_DURATION_BUCKETS_SECONDS: readonly number[] = [
  0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

/** Waits and lags that run from a fraction of a second to minutes: a queue wait, a platform delay. */
export const LONG_DURATION_BUCKETS_SECONDS: readonly number[] = [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300];
