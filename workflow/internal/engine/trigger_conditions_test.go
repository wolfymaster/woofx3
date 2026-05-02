package engine

import (
	"testing"
	"time"

	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// evaluateTrigger is a method on Engine, but its logic is purely about
// the workflow's TriggerConfig and the incoming event — no engine
// services touched. We exercise it through a minimal Engine value.
//
// Trigger conditions are documented in `docs/workflow/schema.md` under
// `TriggerConfig.conditions`. They use the same `${trigger.data.X}`
// expression syntax as step conditions.

type triggerSvcs struct{}

func newTestEngine() *Engine[triggerSvcs] {
	return &Engine[triggerSvcs]{}
}

func TestEvaluateTrigger_AcceptsWhenConditionsMatch(t *testing.T) {
	wf := &types.WorkflowDefinition{
		Trigger: &types.TriggerConfig{
			Type:  "event",
			Event: "cheer.user.twitch",
			Conditions: []types.ConditionConfig{
				{Field: "${trigger.data.amount}", Operator: "gte", Value: 100},
			},
		},
	}
	event := &types.Event{
		ID:   "evt-1",
		Type: "cheer.user.twitch",
		Time: time.Now(),
		Data: map[string]any{"amount": 500},
	}
	if err := newTestEngine().evaluateTrigger(wf, event); err != nil {
		t.Errorf("evaluateTrigger returned %v, want nil", err)
	}
}

func TestEvaluateTrigger_RejectsWhenConditionFails(t *testing.T) {
	wf := &types.WorkflowDefinition{
		Trigger: &types.TriggerConfig{
			Type:  "event",
			Event: "cheer.user.twitch",
			Conditions: []types.ConditionConfig{
				{Field: "${trigger.data.amount}", Operator: "gte", Value: 100},
			},
		},
	}
	event := &types.Event{
		ID:   "evt-2",
		Type: "cheer.user.twitch",
		Time: time.Now(),
		Data: map[string]any{"amount": 50},
	}
	err := newTestEngine().evaluateTrigger(wf, event)
	if err == nil {
		t.Fatal("expected evaluateTrigger to return an error when condition fails")
	}
}

func TestEvaluateTrigger_NoConditionsAlwaysAccepts(t *testing.T) {
	wf := &types.WorkflowDefinition{
		Trigger: &types.TriggerConfig{
			Type:  "event",
			Event: "cheer.user.twitch",
		},
	}
	event := &types.Event{
		ID:   "evt-3",
		Type: "cheer.user.twitch",
		Time: time.Now(),
		Data: map[string]any{},
	}
	if err := newTestEngine().evaluateTrigger(wf, event); err != nil {
		t.Errorf("evaluateTrigger returned %v, want nil", err)
	}
}

func TestEvaluateTrigger_RejectsEventMismatchEvenWithMatchingConditions(t *testing.T) {
	wf := &types.WorkflowDefinition{
		Trigger: &types.TriggerConfig{
			Type:  "event",
			Event: "cheer.user.twitch",
			Conditions: []types.ConditionConfig{
				{Field: "${trigger.data.amount}", Operator: "gte", Value: 0},
			},
		},
	}
	event := &types.Event{
		ID:   "evt-4",
		Type: "follow.user.twitch",
		Time: time.Now(),
		Data: map[string]any{"amount": 500},
	}
	if err := newTestEngine().evaluateTrigger(wf, event); err == nil {
		t.Fatal("expected event-mismatch error before condition evaluation")
	}
}
