package engine

import (
	"errors"
	"strings"
	"testing"

	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

func registerStrictAction(t *testing.T, e *Engine[execSvcs]) {
	t.Helper()
	noop := func(tasks.ActionContext[execSvcs], map[string]any) (map[string]any, error) { return nil, nil }
	validate := func(params map[string]any) error {
		if params["value"] == "bad" {
			return errors.New("value cannot be bad")
		}
		return nil
	}
	if err := e.RegisterValidatedAction("strict", noop, validate); err != nil {
		t.Fatalf("RegisterValidatedAction: %v", err)
	}
}

func strictWorkflow(value string, disabled bool) *types.WorkflowDefinition {
	return &types.WorkflowDefinition{
		ID:   "wf-strict",
		Name: "strict",
		Tasks: []types.TaskDefinition{
			{ID: "s1", Type: "action", Action: "strict", Parameters: map[string]any{"value": value}, Disabled: disabled},
		},
	}
}

func TestRegisterWorkflowRefusesInvalidActionParams(t *testing.T) {
	e := newExecEngine(t)
	registerStrictAction(t, e)

	err := e.RegisterWorkflow(strictWorkflow("bad", false))
	if err == nil || !strings.Contains(err.Error(), `task "s1" (strict): value cannot be bad`) {
		t.Fatalf("err = %v, want the step's validation error", err)
	}
	if _, err := e.GetWorkflow("wf-strict"); err == nil {
		t.Error("an invalid workflow was registered")
	}
}

// A refused update must not take down the version that was working.
func TestRefusedUpdateUnregistersPreviousVersion(t *testing.T) {
	e := newExecEngine(t)
	registerStrictAction(t, e)

	if err := e.RegisterWorkflow(strictWorkflow("good", false)); err != nil {
		t.Fatalf("RegisterWorkflow: %v", err)
	}
	if err := e.RegisterWorkflow(strictWorkflow("bad", false)); err == nil {
		t.Fatal("invalid update accepted")
	}
	if wf, err := e.GetWorkflow("wf-strict"); err == nil {
		t.Fatalf("registered = %v; want the refused workflow unregistered", wf)
	}
}

func TestRegisterWorkflowSkipsDisabledSteps(t *testing.T) {
	e := newExecEngine(t)
	registerStrictAction(t, e)

	if err := e.RegisterWorkflow(strictWorkflow("bad", true)); err != nil {
		t.Fatalf("disabled step was validated: %v", err)
	}
}

func TestRunActionsRefusesInvalidActionParams(t *testing.T) {
	e := newExecEngine(t)
	registerStrictAction(t, e)

	_, err := e.RunActions(ActionRun{
		Label:   "command:strict",
		Actions: []types.TaskDefinition{{Action: "strict", Parameters: map[string]any{"value": "bad"}}},
		Event:   commandEvent(),
	})
	if err == nil || !strings.Contains(err.Error(), "value cannot be bad") {
		t.Fatalf("err = %v, want the step's validation error", err)
	}
}
