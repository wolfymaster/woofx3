package tasks

import (
	"fmt"
	"time"

	"github.com/wolfymaster/woofx3/workflow/internal/expression"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

type WaitTask struct {
	config *types.WaitConfig
}

func NewWaitTask() TaskFactory {
	return func(params map[string]interface{}) (Task, error) {
		return &WaitTask{}, nil
	}
}

func (t *WaitTask) Type() string {
	return "wait"
}

func (t *WaitTask) Execute(ctx *TaskContext) (*types.TaskResult, error) {
	return &types.TaskResult{
		Status: types.TaskStatusWaiting,
		Data: map[string]interface{}{
			"waiting": true,
		},
	}, nil
}

func (t *WaitTask) InitWaitState(taskDef *types.TaskDefinition, execution *types.WorkflowExecution) *types.WaitState {
	waitConfig := taskDef.Wait
	if waitConfig == nil {
		return nil
	}

	timeout := time.Now().Add(5 * time.Minute)
	if waitConfig.Timeout != nil {
		timeout = time.Now().Add(waitConfig.Timeout.Duration)
	}

	onTimeout := "fail"
	if waitConfig.OnTimeout != "" {
		onTimeout = waitConfig.OnTimeout
	}

	state := &types.WaitState{
		EventType:      waitConfig.EventType,
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
	if event.Type != waitState.EventType {
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
	eventResolver.AddSource("event", map[string]interface{}{
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

	eventData := map[string]interface{}{
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

func toFloat64(v interface{}) (float64, error) {
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

func (t *WaitTask) CheckTimeout(waitState *types.WaitState) bool {
	return time.Now().After(waitState.Timeout)
}

func (t *WaitTask) GetExports(waitState *types.WaitState) map[string]interface{} {
	exports := map[string]interface{}{
		"satisfied": waitState.Satisfied,
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
