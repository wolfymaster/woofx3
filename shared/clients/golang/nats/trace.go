package nats

import (
	"context"
	"encoding/json"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"
)

// CloudEvents Distributed Tracing extension attribute names. They are
// top-level attributes of the event, in W3C Trace Context format.
const (
	traceparentAttribute = "traceparent"
	tracestateAttribute  = "tracestate"

	tracerName = "github.com/wolfymaster/woofx3/clients/nats"
)

// eventCarrier reads and writes the tracing attributes of a JSON-encoded
// CloudEvent. Only string-valued attributes are visible to the propagator.
type eventCarrier map[string]json.RawMessage

func (c eventCarrier) Get(key string) string {
	var value string
	if err := json.Unmarshal(c[key], &value); err != nil {
		return ""
	}
	return value
}

func (c eventCarrier) Set(key, value string) {
	quoted, err := json.Marshal(value)
	if err != nil {
		return
	}
	c[key] = quoted
}

func (c eventCarrier) Keys() []string {
	return []string{traceparentAttribute, tracestateAttribute}
}

var _ propagation.TextMapCarrier = eventCarrier{}

// InjectTraceContext returns data, a JSON CloudEvent, with ctx's trace context
// as the traceparent and tracestate attributes. An event that already carries
// a traceparent keeps it, as does anything that is not a JSON object, or a ctx
// with no active span: injecting is best effort and never fails a publish.
func InjectTraceContext(ctx context.Context, data []byte) []byte {
	if !trace.SpanContextFromContext(ctx).IsValid() {
		return data
	}
	var event eventCarrier
	if err := json.Unmarshal(data, &event); err != nil || event == nil {
		return data
	}
	if event.Get(traceparentAttribute) != "" {
		return data
	}
	otel.GetTextMapPropagator().Inject(ctx, event)
	injected, err := json.Marshal(event)
	if err != nil {
		return data
	}
	return injected
}

// ExtractTraceContext returns a context carrying the remote trace context of
// data, or ctx unchanged when data has none or it is malformed.
func ExtractTraceContext(ctx context.Context, data []byte) context.Context {
	var event eventCarrier
	if err := json.Unmarshal(data, &event); err != nil || event == nil {
		return ctx
	}
	return otel.GetTextMapPropagator().Extract(ctx, event)
}

// startConsumerSpan starts the CONSUMER span a handler runs under, as a child
// of the producer's context when the message has one and a new root otherwise.
func startConsumerSpan(subject string, data []byte) (context.Context, trace.Span) {
	ctx := ExtractTraceContext(context.Background(), data)
	return otel.Tracer(tracerName).Start(ctx, subject+" process",
		trace.WithSpanKind(trace.SpanKindConsumer),
		trace.WithAttributes(
			attribute.String("messaging.system", messagingSystem),
			attribute.String("messaging.destination.name", subject),
			attribute.String("messaging.operation.type", "process"),
		))
}
