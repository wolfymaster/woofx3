package logging

import (
	"bytes"
	"context"
	"encoding/json"
	"testing"

	sdktrace "go.opentelemetry.io/otel/sdk/trace"
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
	tests := []struct {
		name     string
		endpoint string
		want     string
	}{
		{name: "bare host", endpoint: "http://localhost:4318", want: "http://localhost:4318/v1/traces"},
		{name: "trailing slash", endpoint: "http://localhost:4318/", want: "http://localhost:4318/v1/traces"},
		{name: "a gateway's own path", endpoint: "https://otlp.example.com/otlp", want: "https://otlp.example.com/otlp/v1/traces"},
		{name: "a gateway path with a trailing slash", endpoint: "https://otlp.example.com/otlp/", want: "https://otlp.example.com/otlp/v1/traces"},
		{name: "already the signal URL", endpoint: "https://otlp.example.com/otlp/v1/traces", want: "https://otlp.example.com/otlp/v1/traces"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := otelEndpointURL(tt.endpoint, otlpTracesPath)
			if err != nil {
				t.Fatalf("otelEndpointURL: %v", err)
			}
			if got != tt.want {
				t.Fatalf("got %s, want %s", got, tt.want)
			}
		})
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

func TestResolveConfigSamplerRatio(t *testing.T) {
	half := 0.5
	tooBig := 1.5
	tests := []struct {
		name     string
		env      string
		explicit *float64
		want     float64
		wantErr  bool
	}{
		{name: "default", want: 1.0},
		{name: "env", env: "0.25", want: 0.25},
		{name: "zero is valid", env: "0", want: 0},
		{name: "explicit beats env", env: "0.25", explicit: &half, want: 0.5},
		{name: "env above one", env: "1.5", wantErr: true},
		{name: "env negative", env: "-0.1", wantErr: true},
		{name: "env not a number", env: "lots", wantErr: true},
		{name: "explicit above one", explicit: &tooBig, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("WOOFX3_OTEL_TRACES_SAMPLER_RATIO", tt.env)
			resolved, err := resolveConfig(Config{ServiceName: "svc", OTelTracesSamplerRatio: tt.explicit})
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected error")
				}
				return
			}
			if err != nil {
				t.Fatalf("resolveConfig: %v", err)
			}
			if resolved.OTelSamplerRatio != tt.want {
				t.Fatalf("ratio = %v, want %v", resolved.OTelSamplerRatio, tt.want)
			}
		})
	}
}

func TestSamplerFollowsParent(t *testing.T) {
	sampler := newSampler(0)
	tid, _ := trace.TraceIDFromHex("0102030405060708090a0b0c0d0e0f10")
	sid, _ := trace.SpanIDFromHex("0102030405060708")
	parent := trace.ContextWithSpanContext(context.Background(), trace.NewSpanContext(trace.SpanContextConfig{
		TraceID: tid, SpanID: sid, TraceFlags: trace.FlagsSampled, Remote: true,
	}))
	if got := sampler.ShouldSample(sdktrace.SamplingParameters{ParentContext: parent, TraceID: tid}).Decision; got != sdktrace.RecordAndSample {
		t.Fatalf("sampled parent decision = %v, want RecordAndSample", got)
	}
	if got := sampler.ShouldSample(sdktrace.SamplingParameters{ParentContext: context.Background(), TraceID: tid}).Decision; got != sdktrace.Drop {
		t.Fatalf("root decision at ratio 0 = %v, want Drop", got)
	}
}
