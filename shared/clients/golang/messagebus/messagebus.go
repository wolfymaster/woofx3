package messagebus

import (
	"fmt"
	"os"
	"strconv"
)

// CreateMessageBus creates a new message bus instance
func CreateMessageBus(config MessageBusConfig) (MessageBus, error) {
	switch config.Backend {
	case "nats":
		natsConfig := config.NATS
		if natsConfig == nil {
			natsConfig = &NATSConfig{}
		}
		natsBackend := NewNATSBackend(*natsConfig, config.Logger)
		if err := natsBackend.Connect(); err != nil {
			return nil, fmt.Errorf("failed to connect to NATS: %w", err)
		}
		return natsBackend, nil

	case "http":
		httpConfig := config.HTTP
		if httpConfig == nil {
			httpConfig = &HTTPConfig{}
		}
		httpBackend := NewHTTPBackend(*httpConfig, config.Logger)
		return httpBackend, nil

	default:
		return nil, fmt.Errorf("unknown backend: %s", config.Backend)
	}
}

// FromEnv creates a message bus from environment variables.
// Uses NATS if credentials are available, otherwise falls back to HTTP backend.
func FromEnv(logger Logger) (MessageBus, error) {
	config := MessageBusConfig{
		Backend: "http", // default
		Logger:  logger,
		NATS: &NATSConfig{
			URL:      getEnvOrDefault("NATS_URL", "wss://connect.ngs.global"),
			Name:     getEnvOrDefault("NATS_NAME", "messagebus-client"),
			JWT:      os.Getenv("NATS_USER_JWT"),
			NKeySeed: os.Getenv("NATS_NKEY_SEED"),
		},
		HTTP: &HTTPConfig{
			URL:              getEnvOrDefault("MESSAGEBUS_HTTP_URL", "ws://localhost:8080/ws"),
			ReconnectTimeout: getEnvIntOrDefault("MESSAGEBUS_RECONNECT_TIMEOUT", 5000),
			MaxRetries:       getEnvIntOrDefault("MESSAGEBUS_MAX_RETRIES", -1), // -1 represents infinity
		},
	}

	// Use NATS if both JWT and NKey are provided
	if config.NATS.JWT != "" && config.NATS.NKeySeed != "" {
		config.Backend = "nats"
		if logger != nil {
			logger.Info("Using NATS backend from environment")
		}
	} else {
		config.Backend = "http"
		if logger != nil {
			logger.Info("Using HTTP backend (NATS credentials not found)")
		}
	}

	return CreateMessageBus(config)
}

// Helper functions for environment variable handling
func getEnvOrDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvIntOrDefault(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if intValue, err := strconv.Atoi(value); err == nil {
			return intValue
		}
	}
	return defaultValue
}
