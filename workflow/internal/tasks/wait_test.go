package tasks

import (
	"strings"
	"testing"
	"time"

	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

func TestValidateWaitConfig(t *testing.T) {
	timeout := &types.Duration{Duration: time.Minute}
	cases := []struct {
		name    string
		cfg     *types.WaitConfig
		wantErr string
	}{
		{name: "missing config", cfg: nil, wantErr: "requires a wait config"},
		{name: "event", cfg: &types.WaitConfig{Type: WaitTypeEvent, Event: "channel.follow", Timeout: timeout, OnTimeout: OnTimeoutContinue}},
		{name: "untyped event", cfg: &types.WaitConfig{Event: "channel.follow"}},
		{name: "event without subject", cfg: &types.WaitConfig{Type: WaitTypeEvent}, wantErr: "requires an event"},
		{name: "unknown type", cfg: &types.WaitConfig{Type: "sleep", Event: "x"}, wantErr: "unknown wait type"},
		{name: "unknown onTimeout", cfg: &types.WaitConfig{Event: "x", OnTimeout: "retry"}, wantErr: "unknown onTimeout"},
		{name: "zero timeout means none", cfg: &types.WaitConfig{Event: "x", Timeout: &types.Duration{}}},
		{name: "sub-second timeout", cfg: &types.WaitConfig{Event: "x", Timeout: &types.Duration{Duration: 30 * time.Microsecond}}, wantErr: "at least 1s"},
		{name: "negative timeout", cfg: &types.WaitConfig{Event: "x", Timeout: &types.Duration{Duration: -time.Minute}}, wantErr: "at least 1s"},
		{name: "empty fields on a delay", cfg: &types.WaitConfig{Type: WaitTypeDelay, DurationMs: 10, Conditions: []types.ConditionConfig{}, Timeout: &types.Duration{}}},
		{name: "zero durationMs on an event wait", cfg: &types.WaitConfig{Event: "x", DurationMs: 0}},
		{name: "aggregation without config", cfg: &types.WaitConfig{Type: WaitTypeAggregation, Event: "x"}, wantErr: "requires an aggregation config"},
		{name: "durationMs on an event wait", cfg: &types.WaitConfig{Event: "x", DurationMs: 5}, wantErr: "only applies to a delay"},
		{name: "delay", cfg: &types.WaitConfig{Type: WaitTypeDelay, DurationMs: 10_000}},
		{name: "delay at minimum", cfg: &types.WaitConfig{Type: WaitTypeDelay, DurationMs: MinDelayMs}},
		{name: "delay at maximum", cfg: &types.WaitConfig{Type: WaitTypeDelay, DurationMs: MaxDelayMs}},
		{name: "delay of zero", cfg: &types.WaitConfig{Type: WaitTypeDelay}, wantErr: "between"},
		{name: "delay over a day", cfg: &types.WaitConfig{Type: WaitTypeDelay, DurationMs: MaxDelayMs + 1}, wantErr: "between"},
		{name: "delay with event", cfg: &types.WaitConfig{Type: WaitTypeDelay, DurationMs: 10, Event: "x"}, wantErr: "does not take an event"},
		{name: "delay with timeout", cfg: &types.WaitConfig{Type: WaitTypeDelay, DurationMs: 10, Timeout: timeout}, wantErr: "does not take a timeout"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateWaitConfig(tc.cfg)
			if tc.wantErr == "" {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("error = %v, want one containing %q", err, tc.wantErr)
			}
		})
	}
}

func TestExpireSettlesDelayAsSatisfied(t *testing.T) {
	cfg := &types.WaitConfig{Type: WaitTypeDelay, DurationMs: 10}
	state := (&WaitTask{}).InitWaitState(&types.TaskDefinition{Wait: cfg}, nil)
	(&WaitTask{}).Expire(cfg, state)
	if !state.Satisfied || state.TimedOut {
		t.Fatalf("delay state = %+v, want satisfied and not timed out", state)
	}
}

func TestExpireTimesOutEventWait(t *testing.T) {
	cfg := &types.WaitConfig{Type: WaitTypeEvent, Event: "x"}
	state := (&WaitTask{}).InitWaitState(&types.TaskDefinition{Wait: cfg}, nil)
	(&WaitTask{}).Expire(cfg, state)
	if state.Satisfied || !state.TimedOut {
		t.Fatalf("event wait state = %+v, want timed out and not satisfied", state)
	}
	if state.OnTimeout != OnTimeoutFail {
		t.Fatalf("onTimeout = %q, want the %q default", state.OnTimeout, OnTimeoutFail)
	}
}

func TestEventWaitWithoutTimeoutHasNoDeadline(t *testing.T) {
	cfg := &types.WaitConfig{Type: WaitTypeEvent, Event: "x"}
	state := (&WaitTask{}).InitWaitState(&types.TaskDefinition{Wait: cfg}, nil)
	if !state.Timeout.IsZero() {
		t.Fatalf("deadline = %s, want none", state.Timeout)
	}
}

// Without a timeout or time window an aggregation has no window to close, so
// events keep counting however late they arrive.
func TestAggregationWithoutWindowKeepsCounting(t *testing.T) {
	cfg := &types.WaitConfig{
		Type:        WaitTypeAggregation,
		Event:       "x",
		Aggregation: &types.AggregationConfig{Strategy: "count", Threshold: 1},
	}
	state := (&WaitTask{}).InitWaitState(&types.TaskDefinition{Wait: cfg}, nil)
	satisfied, err := (&WaitTask{}).ProcessEvent(&types.Event{Type: "x"}, state, nil)
	if err != nil || !satisfied {
		t.Fatalf("satisfied = %v, err = %v; want satisfied", satisfied, err)
	}
}
