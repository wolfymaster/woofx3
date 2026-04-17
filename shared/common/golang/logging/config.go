package logging

import (
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"
)

const (
	defaultLogDirectory = "logs"
)

type Fields map[string]any

type Config struct {
	ServiceName             string
	Level                   slog.Level
	LogDirectory            string
	EnableTerminalTransport bool
	EnableFileTransport     bool
	AddSource               bool
	AllowRuntimeLevelChange bool
	RedactKeys              []string
}

type resolvedConfig struct {
	ServiceName             string
	Level                   slog.Level
	LogDirectory            string
	EnableTerminalTransport bool
	EnableFileTransport     bool
	AddSource               bool
	AllowRuntimeLevelChange bool
	RedactKeys              map[string]struct{}
}

func resolveConfig(cfg Config) (resolvedConfig, error) {
	serviceName := strings.TrimSpace(cfg.ServiceName)
	if serviceName == "" {
		serviceName = strings.TrimSpace(os.Getenv("WOOFX3_LOG_SERVICE"))
	}
	if serviceName == "" {
		return resolvedConfig{}, fmt.Errorf("service name is required")
	}

	level := cfg.Level
	if envLevel := strings.TrimSpace(os.Getenv("WOOFX3_LOG_LEVEL")); envLevel != "" && level == 0 {
		if err := level.UnmarshalText([]byte(envLevel)); err != nil {
			return resolvedConfig{}, fmt.Errorf("invalid WOOFX3_LOG_LEVEL: %w", err)
		}
	}

	logDirectory := strings.TrimSpace(cfg.LogDirectory)
	if logDirectory == "" {
		logDirectory = strings.TrimSpace(os.Getenv("WOOFX3_LOG_DIR"))
	}
	if logDirectory == "" {
		logDirectory = defaultLogDirectory
	}

	enableTerminal := cfg.EnableTerminalTransport
	enableFile := cfg.EnableFileTransport
	if !enableTerminal && !enableFile {
		// Default: both enabled unless explicitly disabled via env.
		enableTerminal = true
		enableFile = true
	}

	allowRuntimeLevelChange := cfg.AllowRuntimeLevelChange
	if !allowRuntimeLevelChange {
		envAllow := strings.TrimSpace(os.Getenv("WOOFX3_LOG_ALLOW_RUNTIME_LEVEL"))
		if envAllow != "" {
			parsed, err := strconv.ParseBool(envAllow)
			if err != nil {
				return resolvedConfig{}, fmt.Errorf("invalid WOOFX3_LOG_ALLOW_RUNTIME_LEVEL: %w", err)
			}
			allowRuntimeLevelChange = parsed
		}
	}

	redactKeys := defaultRedactKeys()
	for _, key := range cfg.RedactKeys {
		if trimmed := normalizeKey(key); trimmed != "" {
			redactKeys[trimmed] = struct{}{}
		}
	}
	if envRedactKeys := strings.TrimSpace(os.Getenv("WOOFX3_LOG_REDACT_KEYS")); envRedactKeys != "" {
		for _, key := range strings.Split(envRedactKeys, ",") {
			if trimmed := normalizeKey(key); trimmed != "" {
				redactKeys[trimmed] = struct{}{}
			}
		}
	}

	return resolvedConfig{
		ServiceName:             serviceName,
		Level:                   level,
		LogDirectory:            logDirectory,
		EnableTerminalTransport: enableTerminal,
		EnableFileTransport:     enableFile,
		AddSource:               cfg.AddSource,
		AllowRuntimeLevelChange: allowRuntimeLevelChange,
		RedactKeys:              redactKeys,
	}, nil
}

func defaultRedactKeys() map[string]struct{} {
	keys := map[string]struct{}{}
	for _, key := range []string{"password", "token", "secret", "authorization", "cookie"} {
		keys[key] = struct{}{}
	}
	return keys
}

func normalizeKey(key string) string {
	return strings.ToLower(strings.TrimSpace(key))
}
