package v1

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"go.opentelemetry.io/otel/attribute"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
)

func steppedClock(step time.Duration) func() time.Time {
	current := time.Unix(0, 0)
	return func() time.Time {
		current = current.Add(step)
		return current
	}
}

func collectDuration(t *testing.T, reader *sdkmetric.ManualReader, name string) (metricdata.Metrics, bool) {
	t.Helper()
	var rm metricdata.ResourceMetrics
	if err := reader.Collect(context.Background(), &rm); err != nil {
		t.Fatalf("Collect: %v", err)
	}
	for _, scope := range rm.ScopeMetrics {
		for _, m := range scope.Metrics {
			if m.Name == name {
				return m, true
			}
		}
	}
	return metricdata.Metrics{}, false
}

func newMetrics(t *testing.T, side RPCSide) (*RPCMetrics, *sdkmetric.ManualReader) {
	t.Helper()
	reader := sdkmetric.NewManualReader()
	provider := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader))
	metrics, err := NewRPCMetrics(provider.Meter("test"), side, []float64{0.1, 1})
	if err != nil {
		t.Fatalf("NewRPCMetrics: %v", err)
	}
	metrics.now = steppedClock(500 * time.Millisecond)
	return metrics, reader
}

// twirpBackend answers like a Twirp server: 200 for Ok, a JSON error for the rest.
func twirpBackend() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/Ok"):
			_, _ = io.WriteString(w, "{}")
		case strings.HasSuffix(r.URL.Path, "/Missing"):
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			_, _ = io.WriteString(w, `{"code":"not_found","msg":"no such thing"}`)
		default:
			w.WriteHeader(http.StatusBadGateway)
			_, _ = io.WriteString(w, "<html>bad gateway</html>")
		}
	})
}

var rpcCases = []struct {
	name      string
	path      string
	wantAttrs []attribute.KeyValue
	wantBody  string
	recorded  bool
}{
	{
		name: "a call that succeeds", path: "/twirp/woofx3.db.WorkflowService/Ok", recorded: true, wantBody: "{}",
		wantAttrs: []attribute.KeyValue{
			attribute.String("rpc.system", "twirp"),
			attribute.String("rpc.service", "woofx3.db.WorkflowService"),
			attribute.String("rpc.method", "Ok"),
		},
	},
	{
		name: "a Twirp error is told by its code", path: "/twirp/woofx3.db.WorkflowService/Missing", recorded: true,
		wantBody: `{"code":"not_found","msg":"no such thing"}`,
		wantAttrs: []attribute.KeyValue{
			attribute.String("rpc.system", "twirp"),
			attribute.String("rpc.service", "woofx3.db.WorkflowService"),
			attribute.String("rpc.method", "Missing"),
			attribute.String("error.type", "not_found"),
		},
	},
	{
		name: "a failure that is not a Twirp error is unknown", path: "/twirp/woofx3.db.WorkflowService/Broken", recorded: true,
		wantBody: "<html>bad gateway</html>",
		wantAttrs: []attribute.KeyValue{
			attribute.String("rpc.system", "twirp"),
			attribute.String("rpc.service", "woofx3.db.WorkflowService"),
			attribute.String("rpc.method", "Broken"),
			attribute.String("error.type", "unknown"),
		},
	},
	{name: "a path that is not Twirp is not recorded", path: "/healthz", recorded: false, wantBody: "<html>bad gateway</html>"},
}

func assertDuration(t *testing.T, reader *sdkmetric.ManualReader, name string, want []attribute.KeyValue, recorded bool) {
	t.Helper()
	m, found := collectDuration(t, reader, name)
	if found != recorded {
		t.Fatalf("%s recorded = %v, want %v", name, found, recorded)
	}
	if !recorded {
		return
	}
	if m.Unit != "s" {
		t.Errorf("unit = %q, want s", m.Unit)
	}
	points := m.Data.(metricdata.Histogram[float64]).DataPoints
	if len(points) != 1 {
		t.Fatalf("got %d points, want 1", len(points))
	}
	wantSet := attribute.NewSet(want...)
	if !points[0].Attributes.Equals(&wantSet) {
		t.Errorf("attributes = %v, want %v", points[0].Attributes.ToSlice(), want)
	}
	if points[0].Count != 1 || points[0].Sum != 0.5 {
		t.Errorf("count/sum = %d/%v, want 1/0.5", points[0].Count, points[0].Sum)
	}
}

func TestRPCClientDuration(t *testing.T) {
	for _, tc := range rpcCases {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(twirpBackend())
			defer server.Close()
			metrics, reader := newMetrics(t, RPCClient)
			client := WithRPCMetrics(nil, metrics)

			resp, err := client.Post(server.URL+tc.path, "application/json", strings.NewReader("{}"))
			if err != nil {
				t.Fatalf("Post: %v", err)
			}
			body, _ := io.ReadAll(resp.Body)
			_ = resp.Body.Close()

			if string(body) != tc.wantBody {
				t.Errorf("caller read %q, want %q: the body must pass through whole", body, tc.wantBody)
			}
			assertDuration(t, reader, "rpc.client.duration", tc.wantAttrs, tc.recorded)
		})
	}
}

func TestRPCClientDurationWithoutAResponse(t *testing.T) {
	server := httptest.NewServer(twirpBackend())
	url := server.URL
	server.Close()
	metrics, reader := newMetrics(t, RPCClient)

	_, err := WithRPCMetrics(nil, metrics).Post(url+"/twirp/woofx3.db.WorkflowService/Ok", "application/json", strings.NewReader("{}"))
	if err == nil {
		t.Fatal("the call to a closed server succeeded")
	}

	assertDuration(t, reader, "rpc.client.duration", []attribute.KeyValue{
		attribute.String("rpc.system", "twirp"),
		attribute.String("rpc.service", "woofx3.db.WorkflowService"),
		attribute.String("rpc.method", "Ok"),
		attribute.String("error.type", "transport_error"),
	}, true)
}

func TestRPCServerDuration(t *testing.T) {
	for _, tc := range rpcCases {
		t.Run(tc.name, func(t *testing.T) {
			metrics, reader := newMetrics(t, RPCServer)
			server := httptest.NewServer(metrics.Handler(twirpBackend()))
			defer server.Close()

			resp, err := http.Post(server.URL+tc.path, "application/json", strings.NewReader("{}"))
			if err != nil {
				t.Fatalf("Post: %v", err)
			}
			body, _ := io.ReadAll(resp.Body)
			_ = resp.Body.Close()

			if string(body) != tc.wantBody {
				t.Errorf("caller read %q, want %q", body, tc.wantBody)
			}
			assertDuration(t, reader, "rpc.server.duration", tc.wantAttrs, tc.recorded)
		})
	}
}

func TestSplitTwirpPath(t *testing.T) {
	tests := []struct {
		path        string
		service     string
		method      string
		wantMatched bool
	}{
		{"/twirp/a.B/C", "a.B", "C", true},
		{"/twirp/a.B/", "", "", false},
		{"/twirp/a.B", "", "", false},
		{"/twirp/a.B/C/D", "", "", false},
		{"/other/a.B/C", "", "", false},
	}
	for _, tc := range tests {
		t.Run(tc.path, func(t *testing.T) {
			service, method, ok := splitTwirpPath(tc.path)
			if ok != tc.wantMatched || service != tc.service || method != tc.method {
				t.Errorf("got %q %q %v", service, method, ok)
			}
		})
	}
}
