package nats

import (
	"context"
	"testing"
	"time"

	"go.opentelemetry.io/otel/attribute"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
)

// steppedClock advances by step on every read, so a handler is seen to take
// exactly one step.
func steppedClock(step time.Duration) func() time.Time {
	current := time.Unix(0, 0)
	return func() time.Time {
		current = current.Add(step)
		return current
	}
}

func collectProcessDuration(t *testing.T, reader *sdkmetric.ManualReader) metricdata.Metrics {
	t.Helper()
	var rm metricdata.ResourceMetrics
	if err := reader.Collect(context.Background(), &rm); err != nil {
		t.Fatalf("Collect: %v", err)
	}
	for _, scope := range rm.ScopeMetrics {
		for _, m := range scope.Metrics {
			if m.Name == "messaging.process.duration" {
				return m
			}
		}
	}
	t.Fatal("messaging.process.duration was not recorded")
	return metricdata.Metrics{}
}

func TestObservedRecordsProcessDuration(t *testing.T) {
	tests := []struct {
		name    string
		process func()
		wantErr string
	}{
		{name: "a handler that returns", process: func() {}},
		{name: "a handler that panics is recorded as such", process: func() { panic("boom") }, wantErr: errorTypePanic},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			reader := sdkmetric.NewManualReader()
			provider := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader))
			client := newTestClient("nats://127.0.0.1:4222")
			client.now = steppedClock(250 * time.Millisecond)
			if err := client.SetMetrics(provider.Meter("test"), []float64{0.1, 1}); err != nil {
				t.Fatalf("SetMetrics: %v", err)
			}

			func() {
				defer func() { _ = recover() }()
				client.observed("twitch.>", tc.process)
			}()

			m := collectProcessDuration(t, reader)
			if m.Unit != "s" {
				t.Errorf("unit = %q, want s", m.Unit)
			}
			points := m.Data.(metricdata.Histogram[float64]).DataPoints
			if len(points) != 1 {
				t.Fatalf("got %d points, want 1", len(points))
			}
			want := []attribute.KeyValue{
				attribute.String("messaging.system", "nats"),
				attribute.String("messaging.destination.name", "twitch.>"),
			}
			if tc.wantErr != "" {
				want = append(want, attribute.String("error.type", tc.wantErr))
			}
			if got := points[0].Attributes; !got.Equals(ptr(attribute.NewSet(want...))) {
				t.Errorf("attributes = %v, want %v", got.ToSlice(), want)
			}
			if points[0].Count != 1 || points[0].Sum != 0.25 {
				t.Errorf("count/sum = %d/%v, want 1/0.25", points[0].Count, points[0].Sum)
			}
		})
	}
}

func TestObservedWithoutMetricsStillRuns(t *testing.T) {
	client := newTestClient("nats://127.0.0.1:4222")
	ran := false
	client.observed("x", func() { ran = true })
	if !ran {
		t.Fatal("the handler did not run")
	}
}

func ptr[T any](v T) *T { return &v }
