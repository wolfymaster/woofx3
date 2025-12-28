package tasks

import (
	"context"
	"fmt"

	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

type ActionTask[TServices any] struct {
	actionRegistry  *ActionRegistry[TServices]
	actionName      string
	parameters      map[string]interface{}
	servicesBuilder ServicesBuilder[TServices]
	appContext      interface{}
}

func NewActionTask[TServices any](actionRegistry *ActionRegistry[TServices], servicesBuilder ServicesBuilder[TServices], appContext interface{}) TaskFactory {
	return func(params map[string]interface{}) (Task, error) {
		actionName, ok := params["action"].(string)
		if !ok {
			return nil, fmt.Errorf("action parameter is required and must be a string")
		}

		return &ActionTask[TServices]{
			actionRegistry:  actionRegistry,
			actionName:      actionName,
			parameters:      params,
			servicesBuilder: servicesBuilder,
			appContext:      appContext,
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

	var services TServices
	if t.servicesBuilder != nil && t.appContext != nil {
		services = t.servicesBuilder(t.appContext)
	}

	actionCtx := ActionContext[TServices]{
		Context:  context.Background(),
		Services: services,
	}
	result, err := action(actionCtx, t.parameters)
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
