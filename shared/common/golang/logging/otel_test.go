package logging

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"

	"go.opentelemetry.io/otel/trace"
)

func TestResolveConfigOTelDisabledByDefault(t *testing.T) {
	resolved, err := resolveConfig(Config{ServiceName: "test"})
	if err != nil {
		t.Fatalf("resolveConfig: %v", err)
	}
	if resolved.OTelEnabled {
		t.Fatal("OTel must default to disabled without an exporter endpoint")
	}
	if resolved.OTelTracingEnabled {
		t.Fatal("tracing must default to disabled without an exporter endpoint")
	}
	if !resolved.OTelLocalFileEnabled {
		t.Fatal("local trace files must default to enabled")
	}
}

func TestResolveConfigOTelEnabledByEndpointEnv(t *testing.T) {
	t.Setenv(envOTelExporterEndpoint, "http://localhost:4318")

	resolved, err := resolveConfig(Config{ServiceName: "test"})
	if err != nil {
		t.Fatalf("resolveConfig: %v", err)
	}
	if !resolved.OTelEnabled || !resolved.OTelTracingEnabled {
		t.Fatal("a configured endpoint must enable OTel logs and tracing")
	}
}

func TestResolveConfigTracingOverrideWithoutEndpoint(t *testing.T) {
	t.Setenv(envOTelTracingEnabled, "true")

	resolved, err := resolveConfig(Config{ServiceName: "test"})
	if err != nil {
		t.Fatalf("resolveConfig: %v", err)
	}
	if resolved.OTelEnabled {
		t.Fatal("tracing override must not enable OTLP log export")
	}
	if !resolved.OTelTracingEnabled {
		t.Fatal("tracing override must enable tracing")
	}
}

func TestResolveConfigExplicitFieldBeatsEnv(t *testing.T) {
	t.Setenv(envOTelExporterEndpoint, "http://localhost:4318")
	disabled := false

	resolved, err := resolveConfig(Config{ServiceName: "test", OTelEnabled: &disabled})
	if err != nil {
		t.Fatalf("resolveConfig: %v", err)
	}
	if resolved.OTelEnabled {
		t.Fatal("explicit config field must win over the environment")
	}
}

func TestResolveConfigRejectsInvalidBool(t *testing.T) {
	t.Setenv(envOTelEnabled, "yes-please")

	if _, err := resolveConfig(Config{ServiceName: "test"}); err == nil {
		t.Fatal("expected an error for an unparseable boolean")
	}
}

func TestOTelEndpointURLAddsSignalPath(t *testing.T) {
	got, err := otelEndpointURL("http://localhost:4318", otlpTracesPath)
	if err != nil {
		t.Fatalf("otelEndpointURL: %v", err)
	}
	if got != "http://localhost:4318/v1/traces" {
		t.Fatalf("unexpected url: %s", got)
	}

	if _, err := otelEndpointURL("localhost:4318", otlpLogsPath); err == nil {
		t.Fatal("expected an error for an endpoint without a scheme")
	}
}

func TestHandlerOmitsTraceFieldsWithoutSpan(t *testing.T) {
	payload := logOnce(t, context.Background())

	for _, key := range []string{"traceId", "spanId", "requestId"} {
		if _, present := payload[key]; present {
			t.Fatalf("%s must be absent when no span or request id is active", key)
		}
	}
}

func TestHandlerPopulatesTraceFieldsFromContext(t *testing.T) {
	traceID, err := trace.TraceIDFromHex("0123456789abcdef0123456789abcdef")
	if err != nil {
		t.Fatalf("trace id: %v", err)
	}
	spanID, err := trace.SpanIDFromHex("0123456789abcdef")
	if err != nil {
		t.Fatalf("span id: %v", err)
	}

	ctx := trace.ContextWithSpanContext(context.Background(), trace.NewSpanContext(trace.SpanContextConfig{
		TraceID: traceID,
		SpanID:  spanID,
	}))
	ctx = ContextWithRequestID(ctx, "req-1")

	payload := logOnce(t, ctx)

	if payload["traceId"] != traceID.String() {
		t.Fatalf("traceId = %v", payload["traceId"])
	}
	if payload["spanId"] != spanID.String() {
		t.Fatalf("spanId = %v", payload["spanId"])
	}
	if payload["requestId"] != "req-1" {
		t.Fatalf("requestId = %v", payload["requestId"])
	}
}

func logOnce(t *testing.T, ctx context.Context) map[string]any {
	t.Helper()

	buffer := &bytes.Buffer{}
	logger, err := NewWithTransports(
		Config{ServiceName: "test"},
		[]Transport{NewTerminalJSONTransportWithWriter(buffer)},
	)
	if err != nil {
		t.Fatalf("NewWithTransports: %v", err)
	}
	defer logger.Close()

	logger.Slog().InfoContext(ctx, "hello")

	payload := map[string]any{}
	if err := json.Unmarshal(buffer.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal log payload: %v", err)
	}
	return payload
}
