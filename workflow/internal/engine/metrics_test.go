package engine

import (
	"context"
	"errors"
	"testing"

	"go.opentelemetry.io/otel/attribute"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"

	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

func TestRunOutcome(t *testing.T) {
	tests := []struct {
		name   string
		status types.ExecutionStatus
		cause  error
		want   string
	}{
		{"completed", types.ExecutionStatusCompleted, nil, runOutcomeCompleted},
		{"failed", types.ExecutionStatusFailed, errors.New("boom"), runOutcomeFailed},
		{"cancelled", types.ExecutionStatusCancelled, nil, runOutcomeCancelled},
		{"a wait timeout is told apart from other failures", types.ExecutionStatusFailed, errWaitTimeout, runOutcomeTimedOut},
		{"a wrapped wait timeout too", types.ExecutionStatusFailed, errors.Join(errors.New("x"), errWaitTimeout), runOutcomeTimedOut},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := runOutcome(tc.status, tc.cause); got != tc.want {
				t.Fatalf("runOutcome = %q, want %q", got, tc.want)
			}
		})
	}
}

func collect(t *testing.T, reader *sdkmetric.ManualReader) map[string]metricdata.Metrics {
	t.Helper()
	var rm metricdata.ResourceMetrics
	if err := reader.Collect(context.Background(), &rm); err != nil {
		t.Fatalf("Collect: %v", err)
	}
	byName := map[string]metricdata.Metrics{}
	for _, scope := range rm.ScopeMetrics {
		for _, m := range scope.Metrics {
			byName[m.Name] = m
		}
	}
	return byName
}

func sumPoints(t *testing.T, m metricdata.Metrics) map[attribute.Set]int64 {
	t.Helper()
	out := map[attribute.Set]int64{}
	switch data := m.Data.(type) {
	case metricdata.Sum[int64]:
		for _, p := range data.DataPoints {
			out[p.Attributes] = p.Value
		}
	default:
		t.Fatalf("%s is %T, want an int64 sum", m.Name, m.Data)
	}
	return out
}

func histogramPoints(t *testing.T, m metricdata.Metrics) map[attribute.Set]uint64 {
	t.Helper()
	data, ok := m.Data.(metricdata.Histogram[float64])
	if !ok {
		t.Fatalf("%s is %T, want a float64 histogram", m.Name, m.Data)
	}
	out := map[attribute.Set]uint64{}
	for _, p := range data.DataPoints {
		out[p.Attributes] = p.Count
	}
	return out
}

func TestEngineReportsRunsAndSteps(t *testing.T) {
	reader := sdkmetric.NewManualReader()
	provider := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader))
	h := newPanicHarness(t)
	if err := h.engine.SetMetrics(provider.Meter("test"), []float64{0.1, 1}, []float64{1, 10}); err != nil {
		t.Fatalf("SetMetrics: %v", err)
	}
	h.register(t, "ok", "evt.ok", types.TaskDefinition{ID: "a", Type: types.TaskTypeAction, Action: "mark"})
	h.register(t, "bad", "evt.bad", types.TaskDefinition{ID: "b", Type: types.TaskTypeAction, Action: "explode"})

	h.fire(t, "evt.ok", "ok")
	h.fire(t, "evt.bad", "bad")

	got := collect(t, reader)

	runs := got["woofx3.workflow.runs"]
	if runs.Unit != "{run}" {
		t.Errorf("runs unit = %q, want {run}", runs.Unit)
	}
	wantRuns := map[attribute.Set]int64{
		attribute.NewSet(attribute.String("outcome", "completed"), attribute.String("trigger.type", "evt.ok")): 1,
		attribute.NewSet(attribute.String("outcome", "failed"), attribute.String("trigger.type", "evt.bad")):   1,
	}
	assertSums(t, sumPoints(t, runs), wantRuns)

	active := got["woofx3.workflow.runs.active"]
	if active.Unit != "{run}" {
		t.Errorf("active unit = %q, want {run}", active.Unit)
	}
	assertSums(t, sumPoints(t, active), map[attribute.Set]int64{attribute.NewSet(): 0})

	duration := got["woofx3.workflow.run.duration"]
	if duration.Unit != "s" {
		t.Errorf("run duration unit = %q, want s", duration.Unit)
	}
	assertCounts(t, histogramPoints(t, duration), map[attribute.Set]uint64{
		attribute.NewSet(attribute.String("outcome", "completed")): 1,
		attribute.NewSet(attribute.String("outcome", "failed")):    1,
	})

	steps := got["woofx3.workflow.step.duration"]
	if steps.Unit != "s" {
		t.Errorf("step duration unit = %q, want s", steps.Unit)
	}
	assertCounts(t, histogramPoints(t, steps), map[attribute.Set]uint64{
		attribute.NewSet(attribute.String("step.action", "mark"), attribute.String("outcome", "success")):   1,
		attribute.NewSet(attribute.String("step.action", "explode"), attribute.String("outcome", "failed")): 1,
	})
}

func assertSums(t *testing.T, got, want map[attribute.Set]int64) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("got %d points %v, want %d %v", len(got), got, len(want), want)
	}
	for set, w := range want {
		if got[set] != w {
			t.Errorf("point %v = %d, want %d", set.ToSlice(), got[set], w)
		}
	}
}

func assertCounts(t *testing.T, got, want map[attribute.Set]uint64) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("got %d points, want %d", len(got), len(want))
	}
	for set, w := range want {
		if got[set] != w {
			t.Errorf("point %v count = %d, want %d", set.ToSlice(), got[set], w)
		}
	}
}
