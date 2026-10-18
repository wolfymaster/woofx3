package tasks

import (
	"strings"
	"testing"
	"time"

	"github.com/wolfymaster/woofx3/workflow/internal/expression"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

func aggregationWait(t *testing.T, agg *types.AggregationConfig) (*WaitTask, *types.WaitState) {
	t.Helper()
	task := &WaitTask{}
	state := task.InitWaitState(&types.TaskDefinition{
		ID:   "wait-for-bits",
		Type: "wait",
		Wait: &types.WaitConfig{
			Type:        "aggregation",
			Event:       "channel.cheer",
			Aggregation: agg,
		},
	}, nil)
	if state == nil {
		t.Fatal("InitWaitState returned nil for a wait with an aggregation")
	}
	return task, state
}

func cheer(data map[string]any) *types.Event {
	return &types.Event{ID: "e1", Type: "channel.cheer", Source: "test", Time: time.Now(), Data: data}
}

func processCheer(t *testing.T, task *WaitTask, state *types.WaitState, data map[string]any) (bool, error) {
	t.Helper()
	return task.ProcessEvent(cheer(data), state, expression.NewResolver())
}

// The configured field is what gets summed. Before it was wired through, the
// lookup used the strategy name as the path, missed, and fell back to counting
// 1 per event -- so a `sum` quietly behaved like a `count`.
func TestSumUsesTheConfiguredField(t *testing.T) {
	task, state := aggregationWait(t, &types.AggregationConfig{
		Strategy:  "sum",
		Field:     "data.bits",
		Threshold: 1000,
	})

	satisfied, err := processCheer(t, task, state, map[string]any{"bits": 400})
	if err != nil {
		t.Fatalf("ProcessEvent: %v", err)
	}
	if satisfied {
		t.Fatal("400 of 1000 bits does not satisfy the wait")
	}
	if state.Aggregation.Sum != 400 {
		t.Errorf("Sum = %v, want 400 -- the field's value, not 1 per event", state.Aggregation.Sum)
	}

	satisfied, err = processCheer(t, task, state, map[string]any{"bits": 600})
	if err != nil {
		t.Fatalf("ProcessEvent: %v", err)
	}
	if !satisfied {
		t.Fatal("400 + 600 reaches the threshold of 1000")
	}
	if state.Aggregation.Sum != 1000 {
		t.Errorf("Sum = %v, want 1000", state.Aggregation.Sum)
	}
}

func TestTheConfiguredFieldIsCarriedIntoWaitState(t *testing.T) {
	_, state := aggregationWait(t, &types.AggregationConfig{
		Strategy:  "sum",
		Field:     "data.amount",
		Threshold: 10,
	})
	if state.Aggregation.Field != "data.amount" {
		t.Errorf("Field = %q, want data.amount -- config that never reaches the state cannot be read", state.Aggregation.Field)
	}
}

// A sum that cannot find its number is a misconfigured workflow. Counting 1 per
// event instead would leave it looking like it works.
func TestASumWhoseFieldIsMissingFailsRatherThanCountingOne(t *testing.T) {
	task, state := aggregationWait(t, &types.AggregationConfig{
		Strategy:  "sum",
		Field:     "data.bits",
		Threshold: 10,
	})

	_, err := processCheer(t, task, state, map[string]any{"somethingElse": 5})
	if err == nil {
		t.Fatal("want an error naming the missing field")
	}
	if !strings.Contains(err.Error(), "data.bits") {
		t.Errorf("error = %q, want it to name the field", err.Error())
	}
	if state.Aggregation.Sum != 0 {
		t.Errorf("Sum = %v, want 0 -- nothing was added", state.Aggregation.Sum)
	}
}

// Events that carry an obvious amount keep working with no field configured,
// which is the behaviour workflows written before `field` worked rely on.
func TestSumWithNoFieldFallsBackToTheConventionalKeys(t *testing.T) {
	for _, key := range []string{"amount", "value"} {
		task, state := aggregationWait(t, &types.AggregationConfig{
			Strategy:  "sum",
			Threshold: 10,
		})
		if _, err := processCheer(t, task, state, map[string]any{key: 7}); err != nil {
			t.Fatalf("%s: ProcessEvent: %v", key, err)
		}
		if state.Aggregation.Sum != 7 {
			t.Errorf("%s: Sum = %v, want 7", key, state.Aggregation.Sum)
		}
	}
}

func TestSumWithNoFieldAndNoConventionalKeyFails(t *testing.T) {
	task, state := aggregationWait(t, &types.AggregationConfig{
		Strategy:  "sum",
		Threshold: 10,
	})

	_, err := processCheer(t, task, state, map[string]any{"bits": 5})
	if err == nil {
		t.Fatal("want an error: there is no field and no amount or value to fall back to")
	}
	if !strings.Contains(err.Error(), "field") {
		t.Errorf("error = %q, want it to say a field is needed", err.Error())
	}
}

// Counting needs no number: an event without one still counts.
func TestCountNeedsNoNumber(t *testing.T) {
	task, state := aggregationWait(t, &types.AggregationConfig{
		Strategy:  "count",
		Threshold: 3,
	})

	for i := 1; i <= 2; i++ {
		satisfied, err := processCheer(t, task, state, map[string]any{"nothing": "useful"})
		if err != nil {
			t.Fatalf("event %d: %v", i, err)
		}
		if satisfied {
			t.Fatalf("event %d of 3 does not satisfy the wait", i)
		}
	}

	satisfied, err := processCheer(t, task, state, map[string]any{"nothing": "useful"})
	if err != nil {
		t.Fatalf("third event: %v", err)
	}
	if !satisfied {
		t.Fatal("the third of three events satisfies a count of 3")
	}
	if state.Aggregation.Count != 3 {
		t.Errorf("Count = %d, want 3", state.Aggregation.Count)
	}
}

// `threshold` judges one event on its own rather than accumulating.
func TestThresholdChecksASingleEventAgainstItsField(t *testing.T) {
	task, state := aggregationWait(t, &types.AggregationConfig{
		Strategy:  "threshold",
		Field:     "data.bits",
		Threshold: 500,
	})

	satisfied, err := processCheer(t, task, state, map[string]any{"bits": 499})
	if err != nil {
		t.Fatalf("ProcessEvent: %v", err)
	}
	if satisfied {
		t.Fatal("499 does not meet a threshold of 500")
	}

	satisfied, err = processCheer(t, task, state, map[string]any{"bits": 500})
	if err != nil {
		t.Fatalf("ProcessEvent: %v", err)
	}
	if !satisfied {
		t.Fatal("500 meets a threshold of 500")
	}
}

func TestAnEventOfAnotherTypeIsNotAggregated(t *testing.T) {
	task, state := aggregationWait(t, &types.AggregationConfig{
		Strategy:  "sum",
		Field:     "data.bits",
		Threshold: 10,
	})

	other := &types.Event{ID: "e2", Type: "channel.follow", Source: "test", Time: time.Now()}
	satisfied, err := task.ProcessEvent(other, state, expression.NewResolver())
	if err != nil {
		t.Fatalf("ProcessEvent: %v", err)
	}
	if satisfied || state.Aggregation.Sum != 0 {
		t.Errorf("a follow must not count toward a cheer aggregation (sum=%v)", state.Aggregation.Sum)
	}
}

// Past the window the aggregate stops accepting events; it does not restart and
// does not satisfy. The wait then ends by timing out.
func TestEventsPastTheTimeWindowAreIgnored(t *testing.T) {
	task, state := aggregationWait(t, &types.AggregationConfig{
		Strategy:   "sum",
		Field:      "data.bits",
		Threshold:  10,
		TimeWindow: &types.Duration{Duration: time.Minute},
	})
	state.Aggregation.WindowEnd = time.Now().Add(-time.Second)

	satisfied, err := processCheer(t, task, state, map[string]any{"bits": 1000})
	if err != nil {
		t.Fatalf("ProcessEvent: %v", err)
	}
	if satisfied {
		t.Fatal("an event past the window cannot satisfy the wait")
	}
	if state.Aggregation.Sum != 0 {
		t.Errorf("Sum = %v, want 0", state.Aggregation.Sum)
	}
}

func TestFloatAmountsAreSummed(t *testing.T) {
	task, state := aggregationWait(t, &types.AggregationConfig{
		Strategy:  "sum",
		Field:     "data.amount",
		Threshold: 10,
	})

	if _, err := processCheer(t, task, state, map[string]any{"amount": 2.5}); err != nil {
		t.Fatalf("ProcessEvent: %v", err)
	}
	if state.Aggregation.Sum != 2.5 {
		t.Errorf("Sum = %v, want 2.5", state.Aggregation.Sum)
	}
}

// A wait exports both count and sum, so each strategy keeps both current,
// not only the one it decides by.
func TestEveryStrategyKeepsCountAndSumCurrent(t *testing.T) {
	for _, strategy := range []string{"count", "sum", "threshold"} {
		task, state := aggregationWait(t, &types.AggregationConfig{
			Strategy:  strategy,
			Field:     "data.bits",
			Threshold: 1000,
		})
		for _, bits := range []int{100, 250} {
			if _, err := processCheer(t, task, state, map[string]any{"bits": bits}); err != nil {
				t.Fatalf("%s: ProcessEvent: %v", strategy, err)
			}
		}
		if state.Aggregation.Count != 2 || state.Aggregation.Sum != 350 {
			t.Errorf("%s: count = %d, sum = %v, want 2 and 350", strategy, state.Aggregation.Count, state.Aggregation.Sum)
		}
		exports := task.GetExports(state)
		if exports["count"] != 2 || exports["sum"] != 350.0 {
			t.Errorf("%s: exports count = %v, sum = %v, want 2 and 350", strategy, exports["count"], exports["sum"])
		}
	}
}

// An event a count cannot read a number from still counts; it adds nothing to
// the sum rather than failing the wait.
func TestCountAddsNothingToTheSumForAnEventWithoutANumber(t *testing.T) {
	task, state := aggregationWait(t, &types.AggregationConfig{
		Strategy:  "count",
		Field:     "data.bits",
		Threshold: 5,
	})
	if _, err := processCheer(t, task, state, map[string]any{"bits": 40}); err != nil {
		t.Fatalf("ProcessEvent: %v", err)
	}
	if _, err := processCheer(t, task, state, map[string]any{"message": "no bits"}); err != nil {
		t.Fatalf("ProcessEvent: %v", err)
	}
	if state.Aggregation.Count != 2 || state.Aggregation.Sum != 40 {
		t.Errorf("count = %d, sum = %v, want 2 and 40", state.Aggregation.Count, state.Aggregation.Sum)
	}
}

// A sum or threshold refuses an event it cannot read a number from, and that
// event adds to neither total.
func TestAnEventRefusedForItsNumberIsNotCounted(t *testing.T) {
	for _, strategy := range []string{"sum", "threshold"} {
		task, state := aggregationWait(t, &types.AggregationConfig{
			Strategy:  strategy,
			Field:     "data.bits",
			Threshold: 1000,
		})
		if _, err := processCheer(t, task, state, map[string]any{"message": "no bits"}); err == nil {
			t.Fatalf("%s: want an error for an event without the field", strategy)
		}
		if state.Aggregation.Count != 0 || state.Aggregation.Sum != 0 {
			t.Errorf("%s: count = %d, sum = %v, want 0 and 0", strategy, state.Aggregation.Count, state.Aggregation.Sum)
		}
	}
}
