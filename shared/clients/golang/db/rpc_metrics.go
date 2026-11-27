package v1

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

// RPCSide is which end of a Twirp call a RPCMetrics measures. It picks the
// metric: rpc.client.duration or rpc.server.duration.
type RPCSide string

const (
	RPCClient RPCSide = "client"
	RPCServer RPCSide = "server"
)

const (
	twirpPathPrefix = "/twirp/"
	// errorTypeTransport is the error.type of a call that got no response.
	errorTypeTransport = "transport_error"
	// errorTypeUnknown is the error.type of a failed call whose body is not a Twirp error.
	errorTypeUnknown = "unknown"
	// errorBodyLimit bounds how much of a failed response is read for its Twirp code.
	errorBodyLimit = 4096
)

// RPCMetrics times Twirp calls as rpc.client.duration or rpc.server.duration,
// from the HTTP exchange alone, so one wrapper covers every Twirp service.
// Attributes are rpc.system=twirp, rpc.service, rpc.method and, on failure,
// error.type: the Twirp error code.
type RPCMetrics struct {
	duration metric.Float64Histogram
	now      func() time.Time
}

// NewRPCMetrics builds the histogram for side on meter; buckets are its
// boundaries in seconds.
func NewRPCMetrics(meter metric.Meter, side RPCSide, buckets []float64) (*RPCMetrics, error) {
	name := "rpc." + string(side) + ".duration"
	duration, err := meter.Float64Histogram(name,
		metric.WithDescription("Time a Twirp call took, from request to response."),
		metric.WithUnit("s"),
		metric.WithExplicitBucketBoundaries(buckets...))
	if err != nil {
		return nil, fmt.Errorf("creating %s: %w", name, err)
	}
	return &RPCMetrics{duration: duration, now: time.Now}, nil
}

// WithRPCMetrics returns a copy of base whose every Twirp call is timed. base
// may be nil for a default client; its transport, timeout and other settings
// are kept.
func WithRPCMetrics(base *http.Client, metrics *RPCMetrics) *http.Client {
	client := &http.Client{}
	if base != nil {
		copied := *base
		client = &copied
	}
	next := client.Transport
	if next == nil {
		next = http.DefaultTransport
	}
	client.Transport = &rpcTransport{metrics: metrics, next: next}
	return client
}

type rpcTransport struct {
	metrics *RPCMetrics
	next    http.RoundTripper
}

func (t *rpcTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	start := t.metrics.now()
	resp, err := t.next.RoundTrip(req)
	switch {
	case err != nil:
		t.metrics.record(req.Context(), req.URL.Path, start, errorTypeTransport)
	case resp.StatusCode == http.StatusOK:
		t.metrics.record(req.Context(), req.URL.Path, start, "")
	default:
		// Read the code from the body, then hand it back whole.
		head, _ := io.ReadAll(io.LimitReader(resp.Body, errorBodyLimit))
		resp.Body = struct {
			io.Reader
			io.Closer
		}{io.MultiReader(bytes.NewReader(head), resp.Body), resp.Body}
		t.metrics.record(req.Context(), req.URL.Path, start, twirpErrorCode(head))
	}
	return resp, err
}

// Handler times every Twirp call next serves.
func (m *RPCMetrics) Handler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := m.now()
		recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(recorder, r)
		errorType := ""
		if recorder.status != http.StatusOK {
			errorType = twirpErrorCode(recorder.head)
		}
		m.record(r.Context(), r.URL.Path, start, errorType)
	})
}

// record skips what is not a Twirp call, such as a health probe.
func (m *RPCMetrics) record(ctx context.Context, path string, start time.Time, errorType string) {
	service, method, ok := splitTwirpPath(path)
	if !ok {
		return
	}
	attributes := []attribute.KeyValue{
		attribute.String("rpc.system", "twirp"),
		attribute.String("rpc.service", service),
		attribute.String("rpc.method", method),
	}
	if errorType != "" {
		attributes = append(attributes, attribute.String("error.type", errorType))
	}
	m.duration.Record(ctx, m.now().Sub(start).Seconds(), metric.WithAttributes(attributes...))
}

// splitTwirpPath reads `/twirp/<package.Service>/<Method>`.
func splitTwirpPath(path string) (service, method string, ok bool) {
	rest, found := strings.CutPrefix(path, twirpPathPrefix)
	if !found {
		return "", "", false
	}
	service, method, found = strings.Cut(rest, "/")
	if !found || service == "" || method == "" || strings.Contains(method, "/") {
		return "", "", false
	}
	return service, method, true
}

func twirpErrorCode(body []byte) string {
	var parsed struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil || parsed.Code == "" {
		return errorTypeUnknown
	}
	return parsed.Code
}

// statusRecorder remembers the status and the start of an error body, which is
// where Twirp puts its error code.
type statusRecorder struct {
	http.ResponseWriter
	status int
	head   []byte
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

func (r *statusRecorder) Write(data []byte) (int, error) {
	if r.status != http.StatusOK && len(r.head) < errorBodyLimit {
		room := errorBodyLimit - len(r.head)
		r.head = append(r.head, data[:min(room, len(data))]...)
	}
	return r.ResponseWriter.Write(data)
}

// Unwrap lets http.ResponseController reach the real writer.
func (r *statusRecorder) Unwrap() http.ResponseWriter { return r.ResponseWriter }
