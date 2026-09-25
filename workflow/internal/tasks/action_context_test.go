package tasks

import (
	"testing"

	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// ActionContext's fields are copied by hand, so a field can be added to the
// struct and silently arrive empty at every handler. These pin the copy.
func TestActionTaskForwardsTheWholeTaskContext(t *testing.T) {
	registry := NewActionRegistry[struct{}]()

	var got ActionContext[struct{}]
	if err := registry.Register("capture", func(ctx ActionContext[struct{}], _ map[string]any) (map[string]any, error) {
		got = ctx
		return nil, nil
	}); err != nil {
		t.Fatalf("Register: %v", err)
	}

	factory := NewActionTask[struct{}](registry)
	task, err := factory(&types.TaskDefinition{ID: "task-1", Type: "action", Action: "capture"}, map[string]any{})
	if err != nil {
		t.Fatalf("factory: %v", err)
	}

	trigger := &types.Event{ID: "evt-1", Type: "channel.follow"}
	if _, err := task.Execute(&TaskContext{
		WorkflowID:   "wf-1",
		ExecutionID:  "exec-1",
		TaskID:       "task-1",
		TriggerEvent: trigger,
	}); err != nil {
		t.Fatalf("Execute: %v", err)
	}

	if got.WorkflowID != "wf-1" {
		t.Errorf("WorkflowID = %q, want wf-1", got.WorkflowID)
	}
	// The run, not the definition: attributing a side effect only to the
	// workflow cannot answer which run produced it.
	if got.ExecutionID != "exec-1" {
		t.Errorf("ExecutionID = %q, want exec-1", got.ExecutionID)
	}
	if got.TaskID != "task-1" {
		t.Errorf("TaskID = %q, want task-1", got.TaskID)
	}
	if got.TriggerEvent != trigger {
		t.Errorf("TriggerEvent = %+v, want the context's event", got.TriggerEvent)
	}
}
