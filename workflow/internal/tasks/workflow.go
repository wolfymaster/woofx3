package tasks

import (
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

type WorkflowTask struct{}

func NewWorkflowTask() TaskFactory {
	return func(params map[string]interface{}) (Task, error) {
		return &WorkflowTask{}, nil
	}
}

func (t *WorkflowTask) Type() string {
	return "workflow"
}

func (t *WorkflowTask) Execute(ctx *TaskContext) (*types.TaskResult, error) {
	// The workflow task execution is handled specially by the engine,
	// similar to how wait tasks are handled. This Execute method
	// is called but the actual workflow triggering and waiting logic
	// is handled in the engine's executeTasksFromIndex method.
	return &types.TaskResult{
		Status: types.TaskStatusSuccess,
		Data: map[string]interface{}{
			"workflow": "executed",
		},
	}, nil
}
