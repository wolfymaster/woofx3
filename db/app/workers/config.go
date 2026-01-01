package workers

import (
	"os"
	"strconv"
	"time"
)

type Config struct {
	PollInterval     time.Duration
	RetryInterval    time.Duration
	DefaultTTL       time.Duration
	BatchSize        int
	CleanupInterval  time.Duration
	RetentionPeriod  time.Duration
}

func LoadConfig() Config {
	return Config{
		PollInterval:    parseDuration("OUTBOX_POLL_INTERVAL", 500*time.Millisecond),
		RetryInterval:   parseDuration("OUTBOX_RETRY_INTERVAL", 100*time.Millisecond),
		DefaultTTL:      parseDuration("OUTBOX_DEFAULT_TTL", 30*time.Second),
		BatchSize:       parseInt("OUTBOX_BATCH_SIZE", 100),
		CleanupInterval: parseDuration("OUTBOX_CLEANUP_INTERVAL", 1*time.Hour),
		RetentionPeriod: parseDuration("OUTBOX_RETENTION_PERIOD", 7*24*time.Hour),
	}
}

func parseDuration(key string, defaultValue time.Duration) time.Duration {
	val := os.Getenv(key)
	if val == "" {
		return defaultValue
	}

	duration, err := time.ParseDuration(val)
	if err != nil {
		return defaultValue
	}

	return duration
}

func parseInt(key string, defaultValue int) int {
	val := os.Getenv(key)
	if val == "" {
		return defaultValue
	}

	i, err := strconv.Atoi(val)
	if err != nil {
		return defaultValue
	}

	return i
}
