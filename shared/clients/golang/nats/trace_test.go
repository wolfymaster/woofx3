package nats

import (
	"context"
	"encoding/json"
	"testing"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"
)

func installTracer(t *testing.T) *tracetest.InMemoryExporter {
	t.Helper()
	exporter := tracetest.NewInMemoryExporter()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter))
	previousProvider, previousPropagator := otel.GetTracerProvider(), otel.GetTextMapPropagator()
	otel.SetTracerProvider(provider)
	otel.SetTextMapPropagator(propagation.TraceContext{})
	t.Cleanup(func() {
		otel.SetTracerProvider(previousProvider)
		otel.SetTextMapPropagator(previousPropagator)
	})
	return exporter
}

func TestInjectThenConsumerSpanSharesTraceID(t *testing.T) {
	exporter := installTracer(t)
	ctx, producer := otel.Tracer("test").Start(context.Background(), "produce")

	wire := InjectTraceContext(ctx, []byte(`{"id":"1","type":"x"}`))
	handlerCtx, span := startConsumerSpan("some.subject", wire)
	span.End()
	producer.End()

	if got, want := trace.SpanContextFromContext(handlerCtx).TraceID(), producer.SpanContext().TraceID(); got != want {
		t.Fatalf("consumer trace id = %s, want %s", got, want)
	}
	var consumer tracetest.SpanStub
	for _, stub := range exporter.GetSpans() {
		if stub.Name == "some.subject process" {
			consumer = stub
		}
	}
	if consumer.SpanKind != trace.SpanKindConsumer {
		t.Fatalf("span kind = %v, want consumer", consumer.SpanKind)
	}
	if consumer.Parent.SpanID() != producer.SpanContext().SpanID() {
		t.Fatalf("consumer parent = %s, want producer span", consumer.Parent.SpanID())
	}
}

func TestInjectKeepsEventFieldsAndWritesLowercaseAttributes(t *testing.T) {
	installTracer(t)
	ctx, span := otel.Tracer("test").Start(context.Background(), "produce")
	defer span.End()

	var event map[string]any
	if err := json.Unmarshal(InjectTraceContext(ctx, []byte(`{"id":"1"}`)), &event); err != nil {
		t.Fatal(err)
	}
	if event["id"] != "1" {
		t.Fatalf("id lost: %v", event)
	}
	if _, ok := event["traceparent"].(string); !ok {
		t.Fatalf("traceparent missing: %v", event)
	}
}

func TestTraceContextIsBestEffort(t *testing.T) {
	installTracer(t)
	ctx, span := otel.Tracer("test").Start(context.Background(), "produce")
	defer span.End()

	tests := []struct {
		name string
		data string
	}{
		{name: "not json", data: "ping"},
		{name: "json array", data: `[1]`},
		{name: "json null", data: `null`},
		{name: "empty", data: ``},
		{name: "malformed traceparent", data: `{"traceparent":"garbage"}`},
		{name: "non-string traceparent", data: `{"traceparent":5}`},
		{name: "absent", data: `{"id":"1"}`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_ = InjectTraceContext(ctx, []byte(tt.data))
			handlerCtx, consumer := startConsumerSpan("s", []byte(tt.data))
			consumer.End()
			if !trace.SpanContextFromContext(handlerCtx).IsValid() {
				t.Fatal("expected a new root span")
			}
			if trace.SpanContextFromContext(handlerCtx).TraceID() == span.SpanContext().TraceID() {
				t.Fatal("unrelated data must not join the producer's trace")
			}
		})
	}
}

func TestInjectWithoutSpanLeavesDataAlone(t *testing.T) {
	installTracer(t)
	in := []byte(`{"id":"1"}`)
	if got := string(InjectTraceContext(context.Background(), in)); got != string(in) {
		t.Fatalf("got %s", got)
	}
}
