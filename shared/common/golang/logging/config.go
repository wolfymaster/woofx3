package logging

import (
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"

	"github.com/wolfymaster/woofx3/common/config"
)

const (
	defaultLogDirectory = "logs"

	envOTelEnabled          = "WOOFX3_OTEL_ENABLED"
	envOTelExporterEndpoint = "WOOFX3_OTEL_EXPORTER_ENDPOINT"
	envOTelTracingEnabled   = "WOOFX3_OTEL_TRACING_ENABLED"
	envOTelLocalFileEnabled = "WOOFX3_OTEL_LOCAL_FILE_ENABLED"
	envPrettyTerminal       = "WOOFX3_LOG_PRETTY"
	envLogDirectory         = "WOOFX3_LOG_DIR"
)

type Fields map[string]any

type Config struct {
	ServiceName string
	Level       slog.Level
	// LogDirectory is where the log files go, falling back to WOOFX3_LOG_DIR
	// and then ./logs. It is ignored when WOOFX3_DATA_DIR is set: see
	// ResolveLogDirectory.
	LogDirectory            string
	EnableTerminalTransport bool
	EnableFileTransport     bool
	AddSource               bool
	AllowRuntimeLevelChange bool
	RedactKeys              []string

	// PrettyTerminal is tri-state: nil defers to WOOFX3_LOG_PRETTY. A log
	// collector that counts lines (Railway, journald) needs it off, since
	// pretty output spreads one record over many lines.
	PrettyTerminal *bool

	// OTel switches are tri-state: nil defers to the matching WOOFX3_OTEL_*
	// environment variable, a non-nil value overrides it.
	OTelEnabled          *bool
	OTelExporterEndpoint string
	OTelTracingEnabled   *bool
	OTelLocalFileEnabled *bool
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
	PrettyTerminal          bool

	OTelEnabled          bool
	OTelExporterEndpoint string
	OTelTracingEnabled   bool
	OTelLocalFileEnabled bool
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

	logDirectory := ResolveLogDirectory(cfg.LogDirectory)

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

	prettyTerminal, err := resolveBool(cfg.PrettyTerminal, envPrettyTerminal, true)
	if err != nil {
		return resolvedConfig{}, err
	}

	otelExporterEndpoint := strings.TrimSpace(cfg.OTelExporterEndpoint)
	if otelExporterEndpoint == "" {
		otelExporterEndpoint = strings.TrimSpace(os.Getenv(envOTelExporterEndpoint))
	}

	// Without a collector there is nothing to export to, so OTel stays off
	// unless a caller or operator asks for it explicitly.
	otelEnabled, err := resolveBool(cfg.OTelEnabled, envOTelEnabled, otelExporterEndpoint != "")
	if err != nil {
		return resolvedConfig{}, err
	}

	otelTracingEnabled, err := resolveBool(cfg.OTelTracingEnabled, envOTelTracingEnabled, otelEnabled)
	if err != nil {
		return resolvedConfig{}, err
	}

	otelLocalFileEnabled, err := resolveBool(cfg.OTelLocalFileEnabled, envOTelLocalFileEnabled, true)
	if err != nil {
		return resolvedConfig{}, err
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
		PrettyTerminal:          prettyTerminal,
		OTelEnabled:             otelEnabled,
		OTelExporterEndpoint:    otelExporterEndpoint,
		OTelTracingEnabled:      otelTracingEnabled,
		OTelLocalFileEnabled:    otelLocalFileEnabled,
	}, nil
}

// resolveBool applies the package precedence of explicit field over
// environment variable over default.
func resolveBool(explicit *bool, envKey string, fallback bool) (bool, error) {
	if explicit != nil {
		return *explicit, nil
	}
	raw := strings.TrimSpace(os.Getenv(envKey))
	if raw == "" {
		return fallback, nil
	}
	parsed, err := strconv.ParseBool(raw)
	if err != nil {
		return false, fmt.Errorf("invalid %s: %w", envKey, err)
	}
	return parsed, nil
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

// ResolveLogDirectory is the directory New writes to for a configured
// LogDirectory, exported for callers that keep other files beside the logs.
//
// With a data directory the logs are part of the engine's data and live in it:
// WOOFX3_LOG_DIR, anchored in the data directory when relative, else
// <data dir>/logs. The configured directory is then ignored, because callers
// name one under the install root, which may not be writable (Program Files on
// Windows). Without a data directory: the configured directory, else
// WOOFX3_LOG_DIR, else ./logs.
func ResolveLogDirectory(configured string) string {
	fromEnv := strings.TrimSpace(os.Getenv(envLogDirectory))
	if dataDir := config.DataDir(); dataDir != "" {
		logDirectory := fromEnv
		if logDirectory == "" {
			logDirectory = defaultLogDirectory
		}
		return config.ResolveDataPathIn(dataDir, logDirectory)
	}

	if logDirectory := strings.TrimSpace(configured); logDirectory != "" {
		return logDirectory
	}
	if fromEnv != "" {
		return fromEnv
	}
	return defaultLogDirectory
}
