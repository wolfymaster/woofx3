package v1

import (
	"net/http"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"
)

const tracerName = "github.com/wolfymaster/woofx3/clients/db"

// WithTracePropagation returns a copy of base whose every request is a CLIENT
// span under the caller's context and carries that span as the traceparent
// and tracestate headers, so the db proxy continues the trace. base may be nil
// for a default client; its transport, timeout and other settings are kept.
func WithTracePropagation(base *http.Client) *http.Client {
	client := &http.Client{}
	if base != nil {
		copied := *base
		client = &copied
	}
	next := client.Transport
	if next == nil {
		next = http.DefaultTransport
	}
	client.Transport = &traceTransport{next: next}
	return client
}

type traceTransport struct {
	next http.RoundTripper
}

// RoundTrip injects into a clone: a RoundTripper must not modify the request
// it was given.
func (t *traceTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	ctx, span := otel.Tracer(tracerName).Start(req.Context(), req.Method+" "+req.URL.Path,
		trace.WithSpanKind(trace.SpanKindClient),
		trace.WithAttributes(
			attribute.String("http.request.method", req.Method),
			attribute.String("url.path", req.URL.Path),
		))
	defer span.End()

	traced := req.Clone(ctx)
	otel.GetTextMapPropagator().Inject(ctx, propagation.HeaderCarrier(traced.Header))
	resp, err := t.next.RoundTrip(traced)
	if err != nil {
		span.RecordError(err)
		return nil, err
	}
	span.SetAttributes(attribute.Int("http.response.status_code", resp.StatusCode))
	return resp, nil
}
