package messagebus

import (
	"context"
	"log/slog"
	"os"
)

// FromEnv creates a message bus from environment variables
// Uses NATS if credentials are available, otherwise falls back to memory backend
func FromEnv(logger *slog.Logger) (Bus, error) {
	cfg := Config{
		Logger: logger,
		NATS: NATSConfig{
			URL:      getEnvWithDefault("NATS_URL", "tls://connect.ngs.global"),
			Name:     getEnvWithDefault("NATS_NAME", "messagebus-client"),
			JWT:      os.Getenv("NATS_USER_JWT"),
			NKeySeed: os.Getenv("NATS_NKEY_SEED"),
		},
	}

	// Use NATS if both JWT and NKey are provided
	if cfg.NATS.JWT != "" && cfg.NATS.NKeySeed != "" {
		cfg.Backend = BackendNATS
		if logger != nil {
			logger.Info("using NATS backend from environment")
		}
	} else {
		cfg.Backend = BackendMemory
		if logger != nil {
			logger.Info("using memory backend (NATS credentials not found)")
		}
	}

	return New(context.Background(), cfg)
}

func getEnvWithDefault(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}