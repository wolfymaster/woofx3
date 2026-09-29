package tasks

import (
	"encoding/json"
	"fmt"

	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

type ActionTask[TServices any] struct {
	actionRegistry *ActionRegistry[TServices]
	actionName     string
	parameters     map[string]any
}

func NewActionTask[TServices any](actionRegistry *ActionRegistry[TServices]) TaskFactory {
	return func(taskDef *types.TaskDefinition, params map[string]any) (Task, error) {
		if taskDef.Action == "" {
			return nil, fmt.Errorf("action field is required on action tasks")
		}

		// Merge top-level handler-config fields from TaskDefinition into
		// the params map so action handlers can read them uniformly via
		// the params slot. Today only `function` is recognized; future
		// action handlers add their own keys the same way.
		merged := make(map[string]any, len(params)+1)
		for k, v := range params {
			merged[k] = v
		}
		if taskDef.Function != "" {
			merged["function"] = taskDef.Function
		}

		return &ActionTask[TServices]{
			actionRegistry: actionRegistry,
			actionName:     taskDef.Action,
			parameters:     merged,
		}, nil
	}
}

func (t *ActionTask[TServices]) Type() string {
	return "action"
}

func (t *ActionTask[TServices]) Execute(ctx *TaskContext) (*types.TaskResult, error) {
	action, err := t.actionRegistry.Get(t.actionName)
	if err != nil {
		return &types.TaskResult{
			Status: types.TaskStatusFailed,
			Error:  err.Error(),
		}, err
	}

	if ctx.DryRun {
		spec, err := t.actionRegistry.Spec(t.actionName)
		if err != nil {
			return &types.TaskResult{Status: types.TaskStatusFailed, Error: err.Error()}, err
		}
		if spec.SideEffect {
			return t.dryRun(spec)
		}
	}

	result, err := action(ActionContext[TServices]{
		WorkflowID:   ctx.WorkflowID,
		ExecutionID:  ctx.ExecutionID,
		TaskID:       ctx.TaskID,
		TriggerEvent: ctx.TriggerEvent,
		Logger:       ctx.Logger,
		Context:      ctx.Context,
	}, t.parameters)
	if err != nil {
		return &types.TaskResult{
			Status: types.TaskStatusFailed,
			Error:  err.Error(),
		}, err
	}

	return &types.TaskResult{
		Status: types.TaskStatusSuccess,
		Data:   result,
	}, nil
}

// dryRun records what a side-effecting action would do, without calling it.
// Decided here, by the engine, and never passed on to the action: an action
// that runs module code could not be trusted to honour it.
func (t *ActionTask[TServices]) dryRun(spec ActionSpec) (*types.TaskResult, error) {
	wouldDo := fmt.Sprintf("would run %s with %s", t.actionName, DescribeParams(t.parameters))
	if spec.DryRun != nil {
		described, err := spec.DryRun(t.parameters)
		if err != nil {
			return &types.TaskResult{Status: types.TaskStatusFailed, Error: err.Error()}, err
		}
		wouldDo = described
	}
	return &types.TaskResult{
		Status: types.TaskStatusSuccess,
		Data:   map[string]any{"dryRun": true, "wouldDo": wouldDo},
	}, nil
}

// DescribeParams renders parameters for a dry-run sentence: compact JSON,
// cut short so one large parameter cannot swamp the run history.
func DescribeParams(params map[string]any) string {
	const limit = 200
	raw, err := json.Marshal(params)
	if err != nil {
		return fmt.Sprintf("%v", params)
	}
	if len(raw) > limit {
		return string(raw[:limit]) + "..."
	}
	return string(raw)
}
