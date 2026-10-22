package workers

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	PollInterval    time.Duration
	RetryInterval   time.Duration
	DefaultTTL      time.Duration
	BatchSize       int
	CleanupInterval time.Duration
	RetentionPeriod time.Duration
	// FactDedupeRetention is how long an applied fact event is remembered,
	// and so how late a redelivery of it is still refused. Redelivery comes
	// from the bus within minutes of the first delivery, and every event of
	// a chat-heavy stream adds a row, so it is hours, not the outbox's days.
	FactDedupeRetention time.Duration
	// FactDedupePruneBatch is how many applied-event rows one delete
	// statement removes.
	FactDedupePruneBatch int
	// EventDetailRetention is how long the detail of what happened is kept:
	// the raw event log of sessions already compacted, settled alerts and
	// settled workflow runs. What a session's analytics need outlives it in
	// the compact tables, so this bounds only drilling into one old event.
	EventDetailRetention time.Duration
	// EventDetailPruneBatch is how many rows one delete removes, or for
	// workflow runs, how many runs one transaction removes with their steps.
	EventDetailPruneBatch int
}

// LoadConfig reads the worker configuration from the environment, each value
// falling back to its default when unset. A value that does not parse, or is
// not positive, is an error, so a misconfigured db-proxy stops at startup
// rather than running on a default it was not given.
func LoadConfig() (Config, error) {
	return loadConfig(os.Getenv)
}

func loadConfig(getenv func(string) string) (Config, error) {
	r := configReader{getenv: getenv}
	config := Config{
		PollInterval:    r.duration("OUTBOX_POLL_INTERVAL", 500*time.Millisecond),
		RetryInterval:   r.duration("OUTBOX_RETRY_INTERVAL", 100*time.Millisecond),
		DefaultTTL:      r.duration("OUTBOX_DEFAULT_TTL", 30*time.Second),
		BatchSize:       r.int("OUTBOX_BATCH_SIZE", 100),
		CleanupInterval: r.duration("OUTBOX_CLEANUP_INTERVAL", 1*time.Hour),
		RetentionPeriod: r.duration("OUTBOX_RETENTION_PERIOD", 7*24*time.Hour),

		FactDedupeRetention:  r.duration("FACT_DEDUPE_RETENTION_PERIOD", 6*time.Hour),
		FactDedupePruneBatch: r.int("FACT_DEDUPE_PRUNE_BATCH_SIZE", 1000),

		EventDetailRetention:  r.duration("EVENT_DETAIL_RETENTION_PERIOD", 7*24*time.Hour),
		EventDetailPruneBatch: r.int("EVENT_DETAIL_PRUNE_BATCH_SIZE", 1000),
	}
	if len(r.errs) > 0 {
		return Config{}, fmt.Errorf("worker configuration: %w", errors.Join(r.errs...))
	}
	return config, nil
}

// configReader reads each setting once, collecting every bad value so one
// startup reports them all.
type configReader struct {
	getenv func(string) string
	errs   []error
}

func (r *configReader) duration(key string, defaultValue time.Duration) time.Duration {
	val := r.getenv(key)
	if val == "" {
		return defaultValue
	}
	duration, err := time.ParseDuration(val)
	if err != nil {
		r.errs = append(r.errs, fmt.Errorf("%s=%q is not a duration (for example 168h or 30s)", key, val))
		return 0
	}
	if duration <= 0 {
		r.errs = append(r.errs, fmt.Errorf("%s=%q must be positive", key, val))
		return 0
	}
	return duration
}

func (r *configReader) int(key string, defaultValue int) int {
	val := r.getenv(key)
	if val == "" {
		return defaultValue
	}
	i, err := strconv.Atoi(val)
	if err != nil {
		r.errs = append(r.errs, fmt.Errorf("%s=%q is not a whole number", key, val))
		return 0
	}
	if i <= 0 {
		r.errs = append(r.errs, fmt.Errorf("%s=%q must be positive", key, val))
		return 0
	}
	return i
}
