package main

import (
	"fmt"
	"time"

	"github.com/wolfymaster/woofx3/clients/nats"
)

type WorkflowEnvConfig struct {
	BarkloaderWsURL  string `env:"WOOFX3_BARKLOADER_WS_URL,required"`
	BarkloaderKey    string `env:"WOOFX3_BARKLOADER_KEY"`
	DatabaseProxyURL string `env:"WOOFX3_DATABASE_PROXY_URL,required"`
	SceneManagerURL  string `env:"WOOFX3_SCENE_MANAGER_URL,required"`
	// OrderedTurnTimeoutSeconds bounds how long one ordered workflow holds
	// its turn before the next one on the same event starts. Unset means the
	// engine's DefaultOrderedTurnTimeout.
	OrderedTurnTimeoutSeconds int `env:"WOOFX3_WORKFLOW_ORDERED_TURN_TIMEOUT_SECONDS"`
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
