package tasks

import (
	"fmt"
	"time"

	"github.com/wolfymaster/woofx3/workflow/internal/expression"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

const (
	WaitTypeEvent       = "event"
	WaitTypeAggregation = "aggregation"
	WaitTypeDelay       = "delay"

	OnTimeoutContinue = "continue"
	OnTimeoutFail     = "fail"

	// DefaultWaitTimeout bounds an event wait that names no timeout, so a wait
	// for an event that never comes still ends.
	DefaultWaitTimeout = 5 * time.Minute

	// MinDelayMs and MaxDelayMs bound a delay wait. A paused run holds its
	// state in memory until it resumes, so a delay longer than a day is more
	// likely a unit mistake than an intent, and it would be lost to a restart
	// anyway. Mirrored by WAIT_DELAY_MIN_MS / WAIT_DELAY_MAX_MS in
	// shared/clients/typescript/api/workflow-definition.ts.
	MinDelayMs int64 = 1
	MaxDelayMs int64 = 24 * 60 * 60 * 1000
)

// ValidateWaitConfig rejects a wait that could never behave as written, so a
// broken definition is refused when it is registered rather than discovered
// by a run that hangs or ends in a way nobody asked for.
//
// An empty type is read as "event": definitions written before the type was
// checked left it out, and the engine has always treated them as event waits.
func ValidateWaitConfig(cfg *types.WaitConfig) error {
	if cfg == nil {
		return fmt.Errorf("wait task requires a wait config")
	}

	switch cfg.Type {
	case WaitTypeDelay:
		return validateDelayConfig(cfg)
	case "", WaitTypeEvent, WaitTypeAggregation:
	default:
		return fmt.Errorf("unknown wait type %q (expected %q, %q or %q)", cfg.Type, WaitTypeEvent, WaitTypeAggregation, WaitTypeDelay)
	}

	if cfg.Event == "" {
		return fmt.Errorf("%s wait requires an event", waitTypeName(cfg))
	}
	if cfg.Type == WaitTypeAggregation && cfg.Aggregation == nil {
		return fmt.Errorf("aggregation wait requires an aggregation config")
	}
	if cfg.DurationMs != 0 {
		return fmt.Errorf("durationMs only applies to a delay wait")
	}
	if cfg.Timeout != nil && cfg.Timeout.Duration <= 0 {
		return fmt.Errorf("wait timeout must be positive, got %s", cfg.Timeout.Duration)
	}
	switch cfg.OnTimeout {
	case "", OnTimeoutContinue, OnTimeoutFail:
	default:
		return fmt.Errorf("unknown onTimeout %q (expected %q or %q)", cfg.OnTimeout, OnTimeoutContinue, OnTimeoutFail)
	}
	return nil
}

// validateDelayConfig refuses event fields on a delay: a delay always ends by
// resuming the run, so a timeout or event on it would be silently ignored and
// the creator left believing it does something.
func validateDelayConfig(cfg *types.WaitConfig) error {
	if cfg.DurationMs < MinDelayMs || cfg.DurationMs > MaxDelayMs {
		return fmt.Errorf("delay durationMs must be between %d and %d, got %d", MinDelayMs, MaxDelayMs, cfg.DurationMs)
	}
	if cfg.Event != "" || len(cfg.Conditions) > 0 || cfg.Aggregation != nil {
		return fmt.Errorf("delay wait does not take an event, conditions or aggregation")
	}
	if cfg.Timeout != nil || cfg.OnTimeout != "" {
		return fmt.Errorf("delay wait does not take a timeout or onTimeout")
	}
	return nil
}

func waitTypeName(cfg *types.WaitConfig) string {
	if cfg.Type == "" {
		return WaitTypeEvent
	}
	return cfg.Type
}

// IsDelay reports whether a wait resumes after a fixed time rather than on an
// event.
func IsDelay(cfg *types.WaitConfig) bool {
	return cfg != nil && cfg.Type == WaitTypeDelay
}

type WaitTask struct {
	config *types.WaitConfig
}

func NewWaitTask() TaskFactory {
	return func(_ *types.TaskDefinition, _ map[string]any) (Task, error) {
		return &WaitTask{}, nil
	}
}

func (t *WaitTask) Type() string {
	return "wait"
}

func (t *WaitTask) Execute(ctx *TaskContext) (*types.TaskResult, error) {
	return &types.TaskResult{
		Status: types.TaskStatusWaiting,
		Data: map[string]any{
			"waiting": true,
		},
	}, nil
}

func (t *WaitTask) InitWaitState(taskDef *types.TaskDefinition, execution *types.WorkflowExecution) *types.WaitState {
	waitConfig := taskDef.Wait
	if waitConfig == nil {
		return nil
	}

	if IsDelay(waitConfig) {
		return &types.WaitState{
			Timeout:        time.Now().Add(time.Duration(waitConfig.DurationMs) * time.Millisecond),
			ReceivedEvents: make([]*types.Event, 0),
		}
	}

	timeout := time.Now().Add(DefaultWaitTimeout)
	if waitConfig.Timeout != nil {
		timeout = time.Now().Add(waitConfig.Timeout.Duration)
	}

	onTimeout := OnTimeoutFail
	if waitConfig.OnTimeout != "" {
		onTimeout = waitConfig.OnTimeout
	}

	state := &types.WaitState{
		Event:          waitConfig.Event,
		Conditions:     waitConfig.Conditions,
		Timeout:        timeout,
		OnTimeout:      onTimeout,
		ReceivedEvents: make([]*types.Event, 0),
		Satisfied:      false,
	}

	if waitConfig.Aggregation != nil {
		windowEnd := timeout
		if waitConfig.Aggregation.TimeWindow != nil {
			windowEnd = time.Now().Add(waitConfig.Aggregation.TimeWindow.Duration)
		}

		state.Aggregation = &types.AggregationState{
			Strategy:    waitConfig.Aggregation.Strategy,
			Count:       0,
			Sum:         0,
			Threshold:   waitConfig.Aggregation.Threshold,
			WindowStart: time.Now(),
			WindowEnd:   windowEnd,
		}
	}

	return state
}

func (t *WaitTask) ProcessEvent(event *types.Event, waitState *types.WaitState, resolver *expression.Resolver) (bool, error) {
	if event.Type != waitState.Event {
		return false, nil
	}

	if !t.matchesConditions(event, waitState.Conditions, resolver) {
		return false, nil
	}

	waitState.ReceivedEvents = append(waitState.ReceivedEvents, event)

	if waitState.Aggregation == nil {
		waitState.Satisfied = true
		return true, nil
	}

	return t.processAggregation(event, waitState)
}

func (t *WaitTask) matchesConditions(event *types.Event, conditions []types.ConditionConfig, resolver *expression.Resolver) bool {
	if len(conditions) == 0 {
		return true
	}

	eventResolver := expression.NewResolver()
	eventResolver.AddSource("event", map[string]any{
		"id":     event.ID,
		"type":   event.Type,
		"source": event.Source,
		"time":   event.Time,
		"data":   event.Data,
	})

	for _, cond := range conditions {
		exprCond := &expression.Condition{
			Field:    cond.Field,
			Operator: cond.Operator,
			Value:    cond.Value,
		}

		matched, err := expression.Evaluate(exprCond, eventResolver)
		if err != nil || !matched {
			return false
		}
	}

	return true
}

func (t *WaitTask) processAggregation(event *types.Event, waitState *types.WaitState) (bool, error) {
	agg := waitState.Aggregation

	if time.Now().After(agg.WindowEnd) {
		return false, nil
	}

	switch agg.Strategy {
	case "count":
		agg.Count++
		if float64(agg.Count) >= agg.Threshold {
			waitState.Satisfied = true
			return true, nil
		}

	case "sum":
		value, err := t.extractNumericValue(event, waitState)
		if err != nil {
			return false, err
		}
		agg.Sum += value
		if agg.Sum >= agg.Threshold {
			waitState.Satisfied = true
			return true, nil
		}

	case "threshold":
		value, err := t.extractNumericValue(event, waitState)
		if err != nil {
			return false, err
		}
		if value >= agg.Threshold {
			waitState.Satisfied = true
			return true, nil
		}
	}

	return false, nil
}

func (t *WaitTask) extractNumericValue(event *types.Event, waitState *types.WaitState) (float64, error) {
	if waitState.Aggregation == nil {
		return 0, fmt.Errorf("no aggregation config")
	}

	eventData := map[string]any{
		"data": event.Data,
	}

	value, err := expression.ResolvePath(eventData, "data."+waitState.Aggregation.Strategy)
	if err != nil {
		if event.Data != nil {
			if v, ok := event.Data["amount"]; ok {
				return toFloat64(v)
			}
			if v, ok := event.Data["value"]; ok {
				return toFloat64(v)
			}
		}
		return 1, nil
	}

	return toFloat64(value)
}

func toFloat64(v any) (float64, error) {
	switch val := v.(type) {
	case int:
		return float64(val), nil
	case int32:
		return float64(val), nil
	case int64:
		return float64(val), nil
	case float32:
		return float64(val), nil
	case float64:
		return val, nil
	default:
		return 0, fmt.Errorf("cannot convert %T to float64", v)
	}
}

// Expire settles a wait whose deadline has passed. A delay is satisfied by
// reaching it; any other wait has timed out and its onTimeout decides the rest.
func (t *WaitTask) Expire(waitConfig *types.WaitConfig, waitState *types.WaitState) {
	if IsDelay(waitConfig) {
		waitState.Satisfied = true
		return
	}
	waitState.TimedOut = true
}

func (t *WaitTask) GetExports(waitState *types.WaitState) map[string]any {
	exports := map[string]any{
		"satisfied": waitState.Satisfied,
		"timedOut":  waitState.TimedOut,
		"events":    waitState.ReceivedEvents,
	}

	if waitState.Aggregation != nil {
		exports["count"] = waitState.Aggregation.Count
		exports["sum"] = waitState.Aggregation.Sum
	}

	if len(waitState.ReceivedEvents) > 0 {
		lastEvent := waitState.ReceivedEvents[len(waitState.ReceivedEvents)-1]
		exports["lastEvent"] = lastEvent
		exports["data"] = lastEvent.Data
	}

	return exports
}
