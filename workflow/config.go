package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/wolfymaster/woofx3/clients/nats"
)

type Config struct {
	BarkloaderWsURL  string `json:"barkloaderWsUrl"`
	DatabaseProxyURL string `json:"databaseProxyUrl"`
}

type WorkflowEnvConfig struct {
	nats.Config
}

func LoadConfiguration() (*Config, error) {
	config := &Config{}

	// Try to load from JSON file
	// First check current directory
	configFile := ".woofx3.json"
	if _, err := os.Stat(configFile); os.IsNotExist(err) {
		// Try parent directory
		configFile = filepath.Join("..", ".woofx3.json")
		if _, err := os.Stat(configFile); os.IsNotExist(err) {
			configFile = "" // No config file found
		}
	}

	if configFile != "" {
		data, err := os.ReadFile(configFile)
		if err != nil {
			return nil, fmt.Errorf("failed to read config file %s: %w", configFile, err)
		}

		if err := json.Unmarshal(data, config); err != nil {
			return nil, fmt.Errorf("failed to parse config file %s: %w", configFile, err)
		}
	}

	// Override with environment variables (take precedence)
	if envVal := os.Getenv("BARKLOADER_WS_URL"); envVal != "" {
		config.BarkloaderWsURL = envVal
	}
	if envVal := os.Getenv("DATABASE_PROXY_URL"); envVal != "" {
		config.DatabaseProxyURL = envVal
	}

	return config, nil
}
