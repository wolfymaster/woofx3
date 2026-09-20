package engine

import (
	"fmt"

	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// ActionRun is a request to run a list of tasks that belongs to no registered
// workflow: a chat command's actions, or anything else that has actions to run
// and no workflow to hang them on.
type ActionRun struct {
	// Label names the run in logs. Not an id: nothing can be looked up by it.
	Label         string
	ApplicationID string
	// Actions run in the order given. A task that already declares DependsOn
	// keeps it, which is how a caller asks for two actions to run together.
	Actions []types.TaskDefinition
	// Event is what the actions resolve `${trigger.data...}` against.
	Event *types.Event
}

// RunActions executes a task list on request, through the same executor a
// workflow run uses: one dependency graph, one resolver, the same action
// handlers. The run is ephemeral -- it is not recorded and announces no
// lifecycle, because both are keyed by a workflow id this run does not have.
//
// Returns the execution id, so a caller can correlate its own logs with the
// engine's. Execution itself is asynchronous, as it is for every other trigger.
func (e *Engine[TServices]) RunActions(run ActionRun) (string, error) {
	if len(run.Actions) == 0 {
		return "", fmt.Errorf("RunActions: no actions to run")
	}
	if run.Event == nil {
		return "", fmt.Errorf("RunActions: no trigger event")
	}

	tasks, err := sequentialTasks(run.Actions)
	if err != nil {
		return "", fmt.Errorf("RunActions: %w", err)
	}

	def := &types.WorkflowDefinition{
		ID:            fmt.Sprintf("adhoc:%s", uuid.New().String()),
		Name:          run.Label,
		ApplicationID: run.ApplicationID,
		Tasks:         tasks,
		Ephemeral:     true,
	}

	execution := e.beginExecution(def, run.Event)
	go e.executeWorkflowInternal(def, execution, run.Event)
	return execution.ID, nil
}

// sequentialTasks gives every task an id and, unless the caller said otherwise,
// makes each one wait for the task before it. An action list is written in the
// order it should happen; the dependency graph is how the engine expresses that.
func sequentialTasks(actions []types.TaskDefinition) ([]types.TaskDefinition, error) {
	tasks := make([]types.TaskDefinition, len(actions))
	seen := make(map[string]bool, len(actions))
	for i, action := range actions {
		task := action
		if task.ID == "" {
			task.ID = fmt.Sprintf("action-%d", i+1)
		}
		if seen[task.ID] {
			return nil, fmt.Errorf("duplicate task id %q", task.ID)
		}
		seen[task.ID] = true
		if task.Type == "" {
			task.Type = "action"
		}
		if len(task.DependsOn) == 0 && i > 0 {
			task.DependsOn = []string{tasks[i-1].ID}
		}
		tasks[i] = task
	}
	return tasks, nil
}
