package logging

import (
	"fmt"
	"log/slog"
	"math"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/wolfymaster/woofx3/common/config"
)

const (
	defaultLogDirectory = "logs"
	defaultSamplerRatio = 1.0

	envOTelEnabled          = "WOOFX3_OTEL_ENABLED"
	envOTelExporterEndpoint = "WOOFX3_OTEL_EXPORTER_ENDPOINT"
	envOTelTracingEnabled   = "WOOFX3_OTEL_TRACING_ENABLED"
	envOTelMetricsEnabled   = "WOOFX3_OTEL_METRICS_ENABLED"
	envOTelMetricsInterval  = "WOOFX3_OTEL_METRICS_INTERVAL_MS"
	envOTelSamplerRatio     = "WOOFX3_OTEL_TRACES_SAMPLER_RATIO"
	envOTelLocalFileEnabled = "WOOFX3_OTEL_LOCAL_FILE_ENABLED"
	envOTelResourceAttrs    = "WOOFX3_OTEL_RESOURCE_ATTRIBUTES"
	envOTelExporterHeaders  = "WOOFX3_OTEL_EXPORTER_HEADERS"
	envVersion              = "WOOFX3_VERSION"
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
	OTelMetricsEnabled   *bool
	OTelLocalFileEnabled *bool

	// OTelMetricsInterval is how often metrics are exported, falling back to
	// WOOFX3_OTEL_METRICS_INTERVAL_MS and then defaultMetricsInterval.
	OTelMetricsInterval time.Duration

	// OTelTracesSamplerRatio is the fraction of root traces kept, in [0, 1].
	// nil defers to WOOFX3_OTEL_TRACES_SAMPLER_RATIO, then 1.0. Spans whose
	// parent was sampled are always kept, so traces stay complete.
	OTelTracesSamplerRatio *float64

	// OTelResourceAttributes and OTelExporterHeaders are comma-separated
	// key=value lists, falling back to WOOFX3_OTEL_RESOURCE_ATTRIBUTES and
	// WOOFX3_OTEL_EXPORTER_HEADERS. Header values are secrets.
	OTelResourceAttributes string
	OTelExporterHeaders    string
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
	OTelMetricsEnabled   bool
	OTelMetricsInterval  time.Duration
	OTelLocalFileEnabled bool
	OTelSamplerRatio     float64

	// OTelResourceAttributes may name service.name or service.version;
	// newOTelResource applies those last so they cannot override the
	// process's own identity.
	OTelResourceAttributes map[string]string
	OTelExporterHeaders    map[string]string
	ServiceVersion         string
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

	if err := config.CheckDataDir(); err != nil {
		return resolvedConfig{}, err
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

	otelMetricsEnabled, err := resolveBool(cfg.OTelMetricsEnabled, envOTelMetricsEnabled, otelEnabled)
	if err != nil {
		return resolvedConfig{}, err
	}

	otelMetricsInterval, err := resolveMetricsInterval(cfg.OTelMetricsInterval)
	if err != nil {
		return resolvedConfig{}, err
	}

	otelSamplerRatio, err := resolveSamplerRatio(cfg.OTelTracesSamplerRatio)
	if err != nil {
		return resolvedConfig{}, err
	}

	otelLocalFileEnabled, err := resolveBool(cfg.OTelLocalFileEnabled, envOTelLocalFileEnabled, true)
	if err != nil {
		return resolvedConfig{}, err
	}

	otelResourceAttributes, err := parseKeyValueList(
		firstNonEmpty(cfg.OTelResourceAttributes, os.Getenv(envOTelResourceAttrs)), envOTelResourceAttrs, entriesShown)
	if err != nil {
		return resolvedConfig{}, err
	}

	otelExporterHeaders, err := parseKeyValueList(
		firstNonEmpty(cfg.OTelExporterHeaders, os.Getenv(envOTelExporterHeaders)), envOTelExporterHeaders, entriesHidden)
	if err != nil {
		return resolvedConfig{}, err
	}
	for name := range otelExporterHeaders {
		redactKeys[normalizeKey(name)] = struct{}{}
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
		OTelMetricsEnabled:      otelMetricsEnabled,
		OTelMetricsInterval:     otelMetricsInterval,
		OTelLocalFileEnabled:    otelLocalFileEnabled,
		OTelSamplerRatio:        otelSamplerRatio,
		OTelResourceAttributes:  otelResourceAttributes,
		OTelExporterHeaders:     otelExporterHeaders,
		ServiceVersion:          strings.TrimSpace(os.Getenv(envVersion)),
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

// resolveMetricsInterval applies explicit over environment over default. A set
// but unusable value is an error: exporting at a rate nobody chose is worse
// than refusing to start.
func resolveMetricsInterval(explicit time.Duration) (time.Duration, error) {
	if explicit < 0 {
		return 0, fmt.Errorf("metrics interval must be positive, got %s", explicit)
	}
	if explicit > 0 {
		return explicit, nil
	}
	raw := strings.TrimSpace(os.Getenv(envOTelMetricsInterval))
	if raw == "" {
		return defaultMetricsInterval, nil
	}
	millis, err := strconv.Atoi(raw)
	if err != nil || millis <= 0 {
		return 0, fmt.Errorf("invalid %s: must be a positive integer, got %q", envOTelMetricsInterval, raw)
	}
	return time.Duration(millis) * time.Millisecond, nil
}

// resolveSamplerRatio applies explicit over environment over default. A ratio
// outside [0, 1] is an error: silently sampling at a rate nobody chose would
// hide traces or flood the collector.
func resolveSamplerRatio(explicit *float64) (float64, error) {
	if explicit != nil {
		if math.IsNaN(*explicit) || *explicit < 0 || *explicit > 1 {
			return 0, fmt.Errorf("invalid sampler ratio: must be between 0 and 1, got %v", *explicit)
		}
		return *explicit, nil
	}
	raw := strings.TrimSpace(os.Getenv(envOTelSamplerRatio))
	if raw == "" {
		return defaultSamplerRatio, nil
	}
	ratio, err := strconv.ParseFloat(raw, 64)
	if err != nil || math.IsNaN(ratio) || ratio < 0 || ratio > 1 {
		return 0, fmt.Errorf("invalid %s: must be a number between 0 and 1, got %q", envOTelSamplerRatio, raw)
	}
	return ratio, nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

// entryVisibility says whether an error may quote the text of the entry it
// rejects. Header lists hold credentials, so their entries stay out of errors.
type entryVisibility int

const (
	entriesShown entryVisibility = iota
	entriesHidden
)

// parseKeyValueList parses "k1=v1,k2=v2". Segments split on the first '=', so
// values may contain '='; later duplicate keys win. With entriesHidden, values
// and value-less segments (which may themselves be the secret) stay out of
// errors. Keys and values are percent-decoded after splitting, as in the
// standard OTEL_EXPORTER_OTLP_HEADERS, so "%20" and an encoded comma survive.
func parseKeyValueList(raw string, source string, visibility entryVisibility) (map[string]string, error) {
	out := map[string]string{}
	for index, segment := range strings.Split(raw, ",") {
		segment = strings.TrimSpace(segment)
		if segment == "" {
			continue
		}
		key, value, found := strings.Cut(segment, "=")
		key = strings.TrimSpace(key)
		if !found || key == "" {
			if visibility == entriesHidden {
				return nil, fmt.Errorf("invalid %s: entry %d must be key=value with a non-empty key", source, index+1)
			}
			return nil, fmt.Errorf("invalid %s: %q must be key=value with a non-empty key", source, segment)
		}
		decodedKey, keyErr := url.PathUnescape(key)
		decodedValue, valueErr := url.PathUnescape(strings.TrimSpace(value))
		if keyErr != nil || valueErr != nil {
			// The segment is never echoed: it may hold a credential.
			return nil, fmt.Errorf("invalid %s: entry %d has an invalid percent-escape", source, index+1)
		}
		out[decodedKey] = decodedValue
	}
	return out, nil
}

func defaultRedactKeys() map[string]struct{} {
	keys := map[string]struct{}{}
	for _, key := range []string{
		"password", "token", "secret", "authorization", "cookie",
		normalizeKey(envOTelExporterHeaders), "otelexporterheaders",
	} {
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
