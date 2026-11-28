package v1

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"
)

func TestWithTracePropagationInjectsCallerTrace(t *testing.T) {
	exporter := tracetest.NewInMemoryExporter()
	previousProvider, previousPropagator := otel.GetTracerProvider(), otel.GetTextMapPropagator()
	otel.SetTracerProvider(sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter)))
	otel.SetTextMapPropagator(propagation.TraceContext{})
	t.Cleanup(func() {
		otel.SetTracerProvider(previousProvider)
		otel.SetTextMapPropagator(previousPropagator)
	})

	var received http.Header
	server := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		received = r.Header.Clone()
	}))
	defer server.Close()

	ctx, caller := otel.Tracer("test").Start(context.Background(), "caller")
	defer caller.End()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, server.URL+"/twirp/x", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := WithTracePropagation(nil).Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()

	extracted := otel.GetTextMapPropagator().Extract(context.Background(), propagation.HeaderCarrier(received))
	remote := trace.SpanContextFromContext(extracted)
	if remote.TraceID() != caller.SpanContext().TraceID() {
		t.Fatalf("server saw trace %s, want %s", remote.TraceID(), caller.SpanContext().TraceID())
	}
	if len(req.Header.Values("Traceparent")) != 0 {
		t.Fatal("the caller's request was modified")
	}
	spans := exporter.GetSpans()
	if len(spans) != 1 || spans[0].SpanKind != trace.SpanKindClient || spans[0].SpanContext.SpanID() != remote.SpanID() {
		t.Fatalf("want one client span whose id is on the wire, got %+v", spans)
	}
}
