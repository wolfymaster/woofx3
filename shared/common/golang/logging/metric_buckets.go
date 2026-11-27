package logging

// Explicit histogram boundaries, in seconds. The SDK defaults (0, 5, 10, 25 ...
// 10000) assume milliseconds and would put every seconds-valued observation in
// the first bucket or two. These match
// shared/common/typescript/logging/metric-buckets.ts.

// ShortDurationBucketsSeconds suits work expected to finish in well under a
// second: a step, a handler, an RPC.
func ShortDurationBucketsSeconds() []float64 {
	return []float64{0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10}
}

// LongDurationBucketsSeconds suits waits and lags from a fraction of a second
// to minutes: a run, a queue wait, a platform delay.
func LongDurationBucketsSeconds() []float64 {
	return []float64{0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300}
}
