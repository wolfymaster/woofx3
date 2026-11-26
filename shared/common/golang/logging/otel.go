package logging

import (
	"fmt"
	"net/url"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/resource"
	semconv "go.opentelemetry.io/otel/semconv/v1.34.0"
)

const (
	// Instrumentation scope reported for spans produced by StartSpan.
	tracerName = "github.com/wolfymaster/woofx3/common/logging"

	otlpLogsPath    = "/v1/logs"
	otlpTracesPath  = "/v1/traces"
	otlpMetricsPath = "/v1/metrics"

	otelShutdownTimeout = 5 * time.Second
)

// otelEndpointURL normalizes a collector base URL such as
// "http://localhost:4318" into a fully qualified signal URL. A misconfigured
// endpoint is a startup error rather than a silent fallback to the OTLP
// default of localhost:4318, which would quietly ship telemetry nowhere.
func otelEndpointURL(endpoint string, signalPath string) (string, error) {
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return "", fmt.Errorf("parse OTLP endpoint %q: %w", endpoint, err)
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("OTLP endpoint %q must include a scheme and host, for example http://localhost:4318", endpoint)
	}
	if parsed.Path == "" || parsed.Path == "/" {
		parsed.Path = signalPath
	}
	return parsed.String(), nil
}

// newOTelResource applies configured attributes first, then the version, then
// the service name, so the process's own identity cannot be overridden.
func newOTelResource(resolved resolvedConfig) *resource.Resource {
	attrs := make([]attribute.KeyValue, 0, len(resolved.OTelResourceAttributes)+2)
	for key, value := range resolved.OTelResourceAttributes {
		attrs = append(attrs, attribute.String(key, value))
	}
	if resolved.ServiceVersion != "" {
		attrs = append(attrs, semconv.ServiceVersion(resolved.ServiceVersion))
	}
	attrs = append(attrs, semconv.ServiceName(resolved.ServiceName))
	return resource.NewWithAttributes(semconv.SchemaURL, attrs...)
}
