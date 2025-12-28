package tasks

import (
	"fmt"

	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

type LogTask struct {
	message string
}

func NewLogTask() TaskFactory {
	return func(params map[string]interface{}) (Task, error) {
		message, ok := params["message"].(string)
		if !ok {
			return nil, fmt.Errorf("message parameter is required and must be a string")
		}

		return &LogTask{
			message: message,
		}, nil
	}
}

func (t *LogTask) Type() string {
	return "log"
}

func (t *LogTask) Execute(ctx *TaskContext) (*types.TaskResult, error) {
	ctx.Logger.Info(t.message)

	return &types.TaskResult{
		Status: types.TaskStatusSuccess,
		Data: map[string]interface{}{
			"message": t.message,
		},
	}, nil
}
