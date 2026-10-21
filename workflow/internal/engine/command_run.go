package engine

import (
	"fmt"

	"github.com/wolfymaster/woofx3/workflow/internal/eventmatch"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// CommandRun asks for the workflow a chat command is linked to to run for one
// invocation of the command.
type CommandRun struct {
	WorkflowID string
	// Event is the invocation's `chat.command.<slug>` event, which the run's
	// `${trigger.data...}` resolves against.
	Event *types.Event
}

// CommandRunOutcome is what a command run request did.
type CommandRunOutcome string

const (
	CommandRunStarted          CommandRunOutcome = "started"
	CommandRunConditionsNotMet CommandRunOutcome = "conditions_not_met"
)

// RunCommand starts the workflow a command is linked to and returns its
// execution id once the run has one, before any task runs.
//
// Whoever asks has already matched the command and checked its cooldown and
// who may run it, so this decides nothing about the command; it refuses only
// what is not a command's workflow, or an event that is not the one the
// workflow's trigger names: its steps read `${trigger.data...}` in that
// event's shape, so another command's event would run them on the wrong
// payload. The workflow's trigger conditions still
// apply, as they would to an event, since an author can add them.
//
// Only a workflow whose trigger has type "command" runs this way. Such a
// workflow is never offered events (WorkflowRegistry.GetByEvent), which is what
// keeps the `chat.command.<slug>` event of the same invocation from running it
// a second time.
func (e *Engine[TServices]) RunCommand(run CommandRun) (CommandRunOutcome, string, error) {
	if e.ctx.Err() != nil {
		return "", "", errEngineStopped
	}
	if run.Event == nil {
		return "", "", fmt.Errorf("RunCommand: no command event")
	}
	def, err := e.workflowRegistry.Get(run.WorkflowID)
	if err != nil {
		return "", "", fmt.Errorf("RunCommand: %w", err)
	}
	if def.Trigger == nil || def.Trigger.Type != types.TriggerTypeCommand {
		return "", "", fmt.Errorf("RunCommand: workflow %s is not a command's workflow", def.ID)
	}
	if !eventmatch.Matches(def.Trigger.Event, run.Event.Type) {
		return "", "", fmt.Errorf("RunCommand: workflow %s runs on %q, not on %q", def.ID, def.Trigger.Event, run.Event.Type)
	}

	viewer := e.newViewerLoader(viewerTrigger(def), run.Event)
	if unmet := e.unmetTriggerConditions(def, run.Event, viewer); len(unmet) > 0 {
		e.logger.Info("Command workflow not run: trigger conditions not met",
			"workflow", def.ID,
			"event_type", run.Event.Type,
			"event_id", run.Event.ID,
			"unmet", describeUnmet(unmet))
		return CommandRunConditionsNotMet, "", nil
	}

	execution := e.beginExecutionAs(def, run.Event, run.Event.DryRun, viewer)
	e.safeGo("run", refTo(execution), func() {
		e.runExecution(def, execution, run.Event)
	})
	return CommandRunStarted, execution.ID, nil
}
