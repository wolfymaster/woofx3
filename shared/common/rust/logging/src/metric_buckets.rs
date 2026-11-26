//! Explicit histogram boundaries, in seconds. The SDK defaults assume
//! milliseconds and would put every seconds-valued observation in the first
//! bucket or two. Keep in step with
//! `shared/common/typescript/logging/metric-buckets.ts`.

/// Work expected to finish in well under a second: a step, a handler, an RPC.
pub const SHORT_DURATION_BUCKETS_SECONDS: [f64; 12] = [
    0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0,
];

/// Waits and lags from a fraction of a second to minutes.
pub const LONG_DURATION_BUCKETS_SECONDS: [f64; 11] = [
    0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0, 120.0, 300.0,
];
