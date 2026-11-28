package services

import (
	"context"
	"testing"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"

	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/config"
)

// ctxPing records the context its handler ran under.
type ctxPing struct {
	pingOnly
	seen chan context.Context
}

func (p ctxPing) Ping(ctx context.Context, _ *client.PingRequest) (*client.PingResponse, error) {
	p.seen <- ctx
	return &client.PingResponse{}, nil
}

func TestHTTPChainContinuesTheCallersTrace(t *testing.T) {
	exporter := tracetest.NewInMemoryExporter()
	previousProvider, previousPropagator := otel.GetTracerProvider(), otel.GetTextMapPropagator()
	otel.SetTracerProvider(sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter)))
	otel.SetTextMapPropagator(propagation.TraceContext{})
	t.Cleanup(func() {
		otel.SetTracerProvider(previousProvider)
		otel.SetTextMapPropagator(previousPropagator)
	})

	handler := ctxPing{seen: make(chan context.Context, 2)}
	server := newChainServerFor(t, config.DefaultHTTPServerConfig(), handler)
	httpClient, err := client.WithServiceToken(client.WithTracePropagation(server.Client()), chainTestToken)
	if err != nil {
		t.Fatalf("WithServiceToken: %v", err)
	}
	common := client.NewCommonServiceProtobufClient(server.URL, httpClient)

	t.Run("a traceparent makes the request span a child", func(t *testing.T) {
		ctx, caller := otel.Tracer("test").Start(context.Background(), "caller")
		defer caller.End()
		if _, err := common.Ping(ctx, &client.PingRequest{}); err != nil {
			t.Fatalf("Ping: %v", err)
		}
		served := trace.SpanContextFromContext(<-handler.seen)
		if served.TraceID() != caller.SpanContext().TraceID() {
			t.Fatalf("handler trace = %s, want %s", served.TraceID(), caller.SpanContext().TraceID())
		}
		for _, stub := range exporter.GetSpans() {
			if stub.SpanContext.SpanID() == served.SpanID() && stub.SpanKind != trace.SpanKindServer {
				t.Fatalf("request span kind = %v, want server", stub.SpanKind)
			}
		}
	})

	t.Run("no traceparent starts a new root", func(t *testing.T) {
		if _, err := common.Ping(context.Background(), &client.PingRequest{}); err != nil {
			t.Fatalf("Ping: %v", err)
		}
		served := trace.SpanContextFromContext(<-handler.seen)
		if !served.IsValid() {
			t.Fatal("handler ran without a span")
		}
	})
}
