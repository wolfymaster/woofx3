package engine

import (
	"fmt"
	"time"

	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// completeDryRunWait settles a wait in a dry run at once, recording what it
// would have waited for. A dry run is a preview someone is watching, and a
// wait for an event that a preview will never cause would hold it forever.
//
// Its exports are those of a wait satisfied by nothing: `satisfied` is true
// so the steps after it run, and there are no events to read.
func (e *Engine[TServices]) completeDryRunWait(
	execution *types.WorkflowExecution,
	taskDef *types.TaskDefinition,
	taskExec *types.TaskExecution,
	index int,
	taskExports map[string]map[string]any,
) {
	now := time.Now()
	exports := map[string]any{
		"dryRun":    true,
		"satisfied": true,
		"events":    []any{},
	}
	if taskDef.Wait.Aggregation != nil {
		exports["count"] = 0
		exports["sum"] = 0.0
	}
	taskExports[taskDef.ID] = exports
	taskExec.Status = types.TaskStatusSuccess
	taskExec.CompletedAt = &now
	taskExec.Result = &types.TaskResult{
		Status:  types.TaskStatusSuccess,
		Data:    map[string]any{"dryRun": true, "wouldDo": describeWait(taskDef.Wait)},
		Exports: exports,
	}
	e.recordStep(execution, taskDef.ID, index, nil, taskExec)
	e.logger.Info("Wait skipped (dry run)", "workflow", execution.WorkflowID, "execution", execution.ID, "task", taskDef.ID)
}

func describeWait(wait *types.WaitConfig) string {
	sentence := fmt.Sprintf("would wait for a %s event", wait.Event)
	if wait.Aggregation != nil {
		sentence = fmt.Sprintf("would wait for %s events to add up", wait.Event)
	}
	if wait.Timeout != nil {
		sentence += fmt.Sprintf(" for up to %s", wait.Timeout.Duration)
	}
	return sentence
}
