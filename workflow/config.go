package main

import (
	"fmt"
	"strconv"
	"time"

	"github.com/wolfymaster/woofx3/clients/nats"
	commonconfig "github.com/wolfymaster/woofx3/common/config"
	"github.com/wolfymaster/woofx3/workflow/internal/engine"
)

// DefaultDbRequestTimeout bounds one request to the db proxy when
// WOOFX3_WORKFLOW_DB_TIMEOUT is unset. A request still running after it is a
// db proxy that is not answering, and the caller is better off with an error.
const DefaultDbRequestTimeout = 5 * time.Second

// reconcileListTimeout bounds one read of workflow, fact or trigger
// definitions from the db proxy. It is the bound for any db client; the
// shared HTTP client's own, shorter timeout (DbTimeout) normally fires first,
// and the fact client's timeout is set to outlast this.
const reconcileListTimeout = 30 * time.Second

type WorkflowEnvConfig struct {
	BarkloaderWsURL  string `env:"WOOFX3_BARKLOADER_WS_URL,required"`
	BarkloaderKey    string `env:"WOOFX3_BARKLOADER_KEY"`
	DatabaseProxyURL string `env:"WOOFX3_DATABASE_PROXY_URL,required"`
	// DbProxyToken is the service token db-proxy requires of every caller.
	DbProxyToken    string `env:"WOOFX3_DB_PROXY_TOKEN,required"`
	SceneManagerURL string `env:"WOOFX3_SCENE_MANAGER_URL,required"`
	// OrderedTurnTimeoutSeconds bounds how long one ordered workflow holds
	// its turn before the next one on the same event starts. Unset means the
	// engine's DefaultOrderedTurnTimeout.
	OrderedTurnTimeoutSeconds int `env:"WOOFX3_WORKFLOW_ORDERED_TURN_TIMEOUT_SECONDS"`
	// DbTimeout caps every request on the db proxy client, as a Go duration
	// ("5s", "750ms"). Unset means DefaultDbRequestTimeout.
	DbTimeout string `env:"WOOFX3_WORKFLOW_DB_TIMEOUT"`
	// RunRetention is how long a settled run stays in memory, as a Go
	// duration. Unset means engine.DefaultRunRetentionTTL.
	RunRetention string `env:"WOOFX3_WORKFLOW_RUN_RETENTION"`
	// RunSweepInterval is how often settled runs are evicted, as a Go
	// duration. Unset means engine.DefaultRunSweepInterval.
	RunSweepInterval string `env:"WOOFX3_WORKFLOW_RUN_SWEEP_INTERVAL"`
	// MaxSettledRuns caps how many settled runs stay in memory, as a decimal
	// integer. It is a string so an explicit "0" is refused rather than read
	// as unset. Unset means engine.DefaultMaxSettledRuns.
	MaxSettledRuns string `env:"WOOFX3_WORKFLOW_MAX_SETTLED_RUNS"`
	nats.Config
}

// orderedTurnTimeout is OrderedTurnTimeoutSeconds as a duration, refused when
// negative so a typo fails the start rather than disabling the deadline.
// Zero means the engine default.
func (c *WorkflowEnvConfig) orderedTurnTimeout() (time.Duration, error) {
	if c.OrderedTurnTimeoutSeconds < 0 {
		return 0, fmt.Errorf("WOOFX3_WORKFLOW_ORDERED_TURN_TIMEOUT_SECONDS must not be negative, got %d", c.OrderedTurnTimeoutSeconds)
	}
	return time.Duration(c.OrderedTurnTimeoutSeconds) * time.Second, nil
}

// dbProxyToken is DbProxyToken once it passes the shared secret rule, so a
// placeholder fails the start here rather than as refused db-proxy calls.
func (c *WorkflowEnvConfig) dbProxyToken() (string, error) {
	if err := commonconfig.ValidateSecret("dbProxyToken", c.DbProxyToken); err != nil {
		return "", err
	}
	return c.DbProxyToken, nil
}

// dbRequestTimeout is DbTimeout parsed, refused when it does not parse or is
// not positive so a typo fails the start rather than removing the deadline.
func (c *WorkflowEnvConfig) dbRequestTimeout() (time.Duration, error) {
	return positiveDuration("WOOFX3_WORKFLOW_DB_TIMEOUT", c.DbTimeout, DefaultDbRequestTimeout)
}

// runRetention is the engine's run retention with each unset value at its
// default. A value that does not parse, or is not positive, fails the start
// rather than disabling eviction.
func (c *WorkflowEnvConfig) runRetention() (engine.RetentionConfig, error) {
	retention := engine.DefaultRetentionConfig()
	ttl, err := positiveDuration("WOOFX3_WORKFLOW_RUN_RETENTION", c.RunRetention, retention.RetentionTTL)
	if err != nil {
		return engine.RetentionConfig{}, err
	}
	interval, err := positiveDuration("WOOFX3_WORKFLOW_RUN_SWEEP_INTERVAL", c.RunSweepInterval, retention.SweepInterval)
	if err != nil {
		return engine.RetentionConfig{}, err
	}
	maxSettled, err := positiveInt("WOOFX3_WORKFLOW_MAX_SETTLED_RUNS", c.MaxSettledRuns, retention.MaxSettledRuns)
	if err != nil {
		return engine.RetentionConfig{}, err
	}
	retention.RetentionTTL = ttl
	retention.SweepInterval = interval
	retention.MaxSettledRuns = maxSettled
	return retention, nil
}

// positiveInt parses the decimal integer in value, read from the variable
// key, or returns fallback when value is unset.
func positiveInt(key, value string, fallback int) (int, error) {
	if value == "" {
		return fallback, nil
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return 0, fmt.Errorf("%s must be a whole number: %w", key, err)
	}
	if parsed <= 0 {
		return 0, fmt.Errorf("%s must be positive, got %d", key, parsed)
	}
	return parsed, nil
}

// positiveDuration parses the Go duration in value, read from the variable
// key, or returns fallback when value is unset.
func positiveDuration(key, value string, fallback time.Duration) (time.Duration, error) {
	if value == "" {
		return fallback, nil
	}
	parsed, err := time.ParseDuration(value)
	if err != nil {
		return 0, fmt.Errorf("%s must be a duration such as 5s: %w", key, err)
	}
	if parsed <= 0 {
		return 0, fmt.Errorf("%s must be positive, got %s", key, parsed)
	}
	return parsed, nil
}
