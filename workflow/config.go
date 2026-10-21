package main

import (
	"fmt"
	"time"

	"github.com/wolfymaster/woofx3/clients/nats"
)

// DefaultDbRequestTimeout bounds one request to the db proxy when
// WOOFX3_WORKFLOW_DB_TIMEOUT is unset. A request still running after it is a
// db proxy that is not answering, and the caller is better off with an error.
const DefaultDbRequestTimeout = 5 * time.Second

// reconcileListTimeout bounds one read of workflow, fact or trigger
// definitions from the db proxy. Calls on the shared db client are capped
// sooner by its own timeout; the fact client's timeout is set to outlast this.
const reconcileListTimeout = 30 * time.Second

type WorkflowEnvConfig struct {
	BarkloaderWsURL  string `env:"WOOFX3_BARKLOADER_WS_URL,required"`
	BarkloaderKey    string `env:"WOOFX3_BARKLOADER_KEY"`
	DatabaseProxyURL string `env:"WOOFX3_DATABASE_PROXY_URL,required"`
	SceneManagerURL  string `env:"WOOFX3_SCENE_MANAGER_URL,required"`
	// OrderedTurnTimeoutSeconds bounds how long one ordered workflow holds
	// its turn before the next one on the same event starts. Unset means the
	// engine's DefaultOrderedTurnTimeout.
	OrderedTurnTimeoutSeconds int `env:"WOOFX3_WORKFLOW_ORDERED_TURN_TIMEOUT_SECONDS"`
	// DbTimeout caps every request on the db proxy client, as a Go duration
	// ("5s", "750ms"). Unset means DefaultDbRequestTimeout.
	DbTimeout string `env:"WOOFX3_WORKFLOW_DB_TIMEOUT"`
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

// dbRequestTimeout is DbTimeout parsed, refused when it does not parse or is
// not positive so a typo fails the start rather than removing the deadline.
func (c *WorkflowEnvConfig) dbRequestTimeout() (time.Duration, error) {
	if c.DbTimeout == "" {
		return DefaultDbRequestTimeout, nil
	}
	timeout, err := time.ParseDuration(c.DbTimeout)
	if err != nil {
		return 0, fmt.Errorf("WOOFX3_WORKFLOW_DB_TIMEOUT must be a duration such as 5s: %w", err)
	}
	if timeout <= 0 {
		return 0, fmt.Errorf("WOOFX3_WORKFLOW_DB_TIMEOUT must be positive, got %s", timeout)
	}
	return timeout, nil
}
