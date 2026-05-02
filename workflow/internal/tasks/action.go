package tasks

import (
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

	result, err := action(ActionContext[TServices]{}, t.parameters)
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
