package config

import (
	"encoding/json"
	"os"
	"strconv"
)

// Config holds the gateway configuration
type Config struct {
	Server ServerConfig `json:"server"`
	NATS   NATSConfig   `json:"nats"`
}

// ServerConfig holds HTTP server configuration
type ServerConfig struct {
	Address string `json:"address"`
}

// NATSConfig holds NATS connection configuration
type NATSConfig struct {
	URL      string `json:"url"`
	Name     string `json:"name"`
	JWT      string `json:"jwt,omitempty"`
	NKeySeed string `json:"nkey_seed,omitempty"`
}

// Load configuration from file or environment variables
func Load(configPath string) (*Config, error) {
	cfg := &Config{
		Server: ServerConfig{
			Address: getEnvWithDefault("MESSAGEBUS_GATEWAY_ADDRESS", "0.0.0.0:9000"),
		},
		NATS: NATSConfig{
			URL:      getEnvWithDefault("NATS_URL", "nats://localhost:4222"),
			Name:     getEnvWithDefault("NATS_NAME", "messagebus-gateway"),
			JWT:      os.Getenv("NATS_USER_JWT"),
			NKeySeed: os.Getenv("NATS_NKEY_SEED"),
		},
	}

	// Load from file if provided
	if configPath != "" {
		data, err := os.ReadFile(configPath)
		if err != nil {
			return nil, err
		}

		if err := json.Unmarshal(data, cfg); err != nil {
			return nil, err
		}
	}

	return cfg, nil
}

func getEnvWithDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvIntWithDefault(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if intValue, err := strconv.Atoi(value); err == nil {
			return intValue
		}
	}
	return defaultValue
}