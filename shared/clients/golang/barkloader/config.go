package barkloader

import (
	"log/slog"
	"time"
)

type Config struct {
	WSURL              string
	Token              string
	OnOpen             func()
	OnClose            func()
	OnError            func(error)
	ReconnectTimeout   time.Duration
	MaxRetries         int // Use 0 for infinite retries
	OnReconnectAttempt ReconnectAttemptHandler
}

func DefaultConfig(websocketUrl string, logger *slog.Logger) *Config {
	return &Config{
		WSURL: websocketUrl,
		OnOpen: func() {
			logger.Info("Barkloader client connected")
		},
		OnClose: func() {
			logger.Info("Barkloader client disconnected")
		},
		OnError: func(err error) {
			logger.Error("Barkloader client error", "error", err)
		},
		ReconnectTimeout: 5 * time.Second,
		MaxRetries:       0, // Infinite retries
	}
}
