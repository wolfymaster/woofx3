package logging

import (
	"context"

	"go.opentelemetry.io/otel/trace"
)

type contextKey int

const requestIDContextKey contextKey = iota

// ContextWithRequestID stores a request correlation id on ctx so that every
// log record emitted with that ctx carries it in the reserved `requestId`
// field without the caller repeating it at each call site.
func ContextWithRequestID(ctx context.Context, requestID string) context.Context {
	if ctx == nil {
		return nil
	}
	return context.WithValue(ctx, requestIDContextKey, requestID)
}

// RequestIDFromContext returns the request id stored by ContextWithRequestID,
// or an empty string when none is present.
func RequestIDFromContext(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	requestID, ok := ctx.Value(requestIDContextKey).(string)
	if !ok {
		return ""
	}
	return requestID
}

// applyTraceContext fills the reserved trace fields from the active span and
// request id. Attributes passed explicitly by the caller already sit in
// topLevel and always win, so instrumentation never overwrites an intentional
// value.
func applyTraceContext(ctx context.Context, topLevel map[string]any) {
	if ctx == nil {
		return
	}

	if _, present := topLevel["requestId"]; !present {
		if requestID := RequestIDFromContext(ctx); requestID != "" {
			topLevel["requestId"] = requestID
		}
	}

	spanContext := trace.SpanContextFromContext(ctx)
	if !spanContext.IsValid() {
		return
	}
	if _, present := topLevel["traceId"]; !present {
		topLevel["traceId"] = spanContext.TraceID().String()
	}
	if _, present := topLevel["spanId"]; !present {
		topLevel["spanId"] = spanContext.SpanID().String()
	}
}
