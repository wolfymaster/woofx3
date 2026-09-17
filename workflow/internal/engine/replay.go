package engine

import (
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// ReplayStep is one recorded step outcome a resume restores from.
type ReplayStep struct {
	TaskID  string
	Status  string
	Attempt int
	Outputs map[string]any
}

// ReplayRequest asks the engine to run a recorded run again.
type ReplayRequest struct {
	WorkflowID string
	// TriggerEvent is the event the original run started from, as recorded.
	TriggerEvent *types.Event
	// FromTaskID resumes at this task, restoring what ran before it. Empty
	// replays the whole run from its trigger.
	FromTaskID string
	// Steps is what the original run recorded. Only consulted when resuming.
	Steps []ReplayStep
	// TriggerID and TriggeredBy correlate the new run with whoever asked for
	// it, replacing whatever the original event carried.
	TriggerID   string
	TriggeredBy string
}

// Replay runs a recorded run again, whole or from one of its steps.
//
// The new run is a fresh execution with its own id, and it runs against the
// workflow's current definition rather than the one the original ran -- the
// definition is not recorded. So a resume locates its starting step by id and
// refuses when an edit has removed it, rather than guessing at a position that
// may now mean a different step.
//
// A refusal is announced as a failed run carrying the reason, so a caller
// waiting on the replay learns why instead of waiting out a timeout.
func (e *Engine[TServices]) Replay(req ReplayRequest) error {
	event := replayEvent(req)

	if req.TriggerEvent == nil {
		return e.refuseReplay(req.WorkflowID, event, errors.New("this run has no recorded trigger event to replay"))
	}

	def, err := e.workflowRegistry.Get(req.WorkflowID)
	if err != nil {
		return e.refuseReplay(req.WorkflowID, event, fmt.Errorf("this workflow is no longer available: %w", err))
	}

	graph, err := NewDependencyGraph(def.Tasks)
	if err != nil {
		return e.refuseReplay(req.WorkflowID, event, fmt.Errorf("this workflow's steps cannot be ordered: %w", err))
	}
	order, err := graph.GetExecutionOrder()
	if err != nil {
		return e.refuseReplay(req.WorkflowID, event, fmt.Errorf("this workflow's steps cannot be ordered: %w", err))
	}

	start, exports, skipped, err := planResume(order, req.Steps, req.FromTaskID)
	if err != nil {
		return e.refuseReplay(req.WorkflowID, event, err)
	}

	go func() {
		execution := e.beginExecution(def, event)
		e.logger.Info("Replaying workflow run",
			"workflow", def.ID,
			"execution", execution.ID,
			"from_task", req.FromTaskID,
			"start_index", start)
		e.runTasksFrom(execution, order, start, exports, event, skipped)
	}()
	return nil
}

// replayEvent is the event a replayed run starts from.
//
// The original event where one was recorded, so `${trigger.*}` resolves exactly
// as it did the first time, with its correlation attributes replaced: the
// replay belongs to whoever asked for it, not to whatever caused the original.
// It is a copy, so the recorded event itself is never changed.
//
// Without a recorded event this is a bare placeholder, which exists only so a
// refusal can still be correlated with the request.
func replayEvent(req ReplayRequest) *types.Event {
	var event types.Event
	if req.TriggerEvent != nil {
		event = *req.TriggerEvent
	} else {
		event = types.Event{ID: uuid.New().String(), Type: "workflow.replay", Source: "workflow", Time: time.Now()}
	}
	event.TriggerID = req.TriggerID
	event.TriggeredBy = req.TriggeredBy
	return &event
}

// refuseReplay announces a replay that cannot run as a failed run carrying the
// reason. It is never recorded: nothing ran.
func (e *Engine[TServices]) refuseReplay(workflowID string, event *types.Event, reason error) error {
	now := time.Now()
	e.emitRunLifecycle(&types.WorkflowExecution{
		ID:           uuid.New().String(),
		WorkflowID:   workflowID,
		Status:       types.ExecutionStatusFailed,
		Error:        reason.Error(),
		TriggerEvent: event,
		StartedAt:    now,
		CompletedAt:  &now,
	})
	e.logger.Warn("Replay refused", "workflow", workflowID, "trigger_id", event.TriggerID, "reason", reason)
	return reason
}

// planResume works out where a resume starts and what it must restore.
//
// Every step before the resume point must have a recorded, successful outcome:
// its outputs are what the remaining steps' expressions resolve against, and
// resuming past a step that never succeeded would run later steps on values
// that do not exist. A condition's recorded result re-derives the branch it
// excluded, so the resumed run skips what the original skipped.
//
// Where a step was attempted more than once, its latest attempt is the one
// that counts.
func planResume(
	order []*types.TaskDefinition,
	steps []ReplayStep,
	fromTaskID string,
) (int, map[string]map[string]any, map[string]bool, error) {
	exports := make(map[string]map[string]any)
	skipped := make(map[string]bool)
	if fromTaskID == "" {
		return 0, exports, skipped, nil
	}

	start := -1
	for i, task := range order {
		if task.ID == fromTaskID {
			start = i
			break
		}
	}
	if start < 0 {
		return 0, nil, nil, fmt.Errorf("step %q no longer exists in this workflow, so the run cannot resume from it", fromTaskID)
	}

	latest := make(map[string]ReplayStep, len(steps))
	for _, step := range steps {
		if current, seen := latest[step.TaskID]; !seen || step.Attempt >= current.Attempt {
			latest[step.TaskID] = step
		}
	}

	for _, task := range order[:start] {
		if skipped[task.ID] {
			continue
		}

		record, recorded := latest[task.ID]
		if !recorded {
			return 0, nil, nil, fmt.Errorf("step %q has no recorded outcome, so the run cannot resume after it", task.ID)
		}

		switch record.Status {
		case string(types.TaskStatusSkipped):
			skipped[task.ID] = true
			continue
		case string(types.TaskStatusSuccess):
		default:
			return 0, nil, nil, fmt.Errorf("step %q did not succeed (%s), so the run cannot resume after it", task.ID, record.Status)
		}

		if len(record.Outputs) > 0 {
			exports[task.ID] = record.Outputs
		}

		if task.Type == "condition" {
			result, ok := record.Outputs["result"].(bool)
			if !ok {
				return 0, nil, nil, fmt.Errorf("condition %q has no recorded result, so the branch it took is unknown", task.ID)
			}
			for _, id := range (&tasks.ConditionTask{}).GetBranchTasks(task, !result) {
				skipped[id] = true
			}
		}
	}

	return start, exports, skipped, nil
}
