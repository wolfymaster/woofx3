package tasks

import (
	"github.com/wolfymaster/woofx3/workflow/internal/expression"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

type ConditionTask struct{}

func NewConditionTask() TaskFactory {
	return func(params map[string]interface{}) (Task, error) {
		return &ConditionTask{}, nil
	}
}

func (t *ConditionTask) Type() string {
	return "condition"
}

func (t *ConditionTask) Execute(ctx *TaskContext) (*types.TaskResult, error) {
	return &types.TaskResult{
		Status: types.TaskStatusSuccess,
		Data: map[string]interface{}{
			"evaluated": true,
		},
	}, nil
}

func (t *ConditionTask) Evaluate(taskDef *types.TaskDefinition, resolver *expression.Resolver) (bool, error) {
	// Build list of conditions from both Condition and Conditions fields
	var conditions []expression.Condition

	// Add single condition if present (backward compatibility)
	if taskDef.Condition != nil {
		conditions = append(conditions, expression.Condition{
			Field:    taskDef.Condition.Field,
			Operator: taskDef.Condition.Operator,
			Value:    taskDef.Condition.Value,
		})
	}

	// Add multiple conditions if present
	for _, c := range taskDef.Conditions {
		conditions = append(conditions, expression.Condition{
			Field:    c.Field,
			Operator: c.Operator,
			Value:    c.Value,
		})
	}

	// If no conditions, return true
	if len(conditions) == 0 {
		return true, nil
	}

	// Evaluate all conditions with the specified logic
	return expression.EvaluateMultiple(conditions, taskDef.ConditionLogic, resolver)
}

func (t *ConditionTask) GetBranchTasks(taskDef *types.TaskDefinition, result bool) []string {
	if result {
		return taskDef.OnTrue
	}
	return taskDef.OnFalse
}
