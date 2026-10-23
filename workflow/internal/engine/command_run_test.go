package engine

import (
	"testing"
	"time"

	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

func hugCommandWorkflow(conditions ...types.ConditionConfig) *types.WorkflowDefinition {
	return &types.WorkflowDefinition{
		ID:   "wf-hug",
		Name: "!hug",
		Trigger: &types.TriggerConfig{
			Type:       types.TriggerTypeCommand,
			Event:      "chat.command.hug",
			Conditions: conditions,
		},
		Tasks: []types.TaskDefinition{{
			ID:         "say",
			Type:       "action",
			Action:     "echo",
			Parameters: map[string]any{"who": "${trigger.data.chatter}"},
		}},
	}
}

func hugEvent() *types.Event {
	return &types.Event{
		ID:       "evt-1",
		Type:     "chat.command.hug",
		Source:   "connectors",
		Time:     time.Now(),
		Platform: "twitch",
		Data:     map[string]any{"chatter": "wolfy", "command": "hug"},
	}
}

func TestRunCommandRunsTheWorkflowFromTheCommandEvent(t *testing.T) {
	h := newManualHarness(t, hugCommandWorkflow())

	outcome, executionID, err := h.engine.RunCommand(CommandRun{WorkflowID: "wf-hug", Event: hugEvent()})
	if err != nil {
		t.Fatalf("RunCommand: %v", err)
	}
	if outcome != CommandRunStarted || executionID == "" {
		t.Fatalf("outcome %q, execution %q; want started with an id", outcome, executionID)
	}
	if status := h.log.awaitSettled(t, executionID); status != types.ExecutionStatusCompleted {
		t.Fatalf("settled %q, want completed", status)
	}
	params, event := h.captured()
	if params["who"] != "wolfy" {
		t.Errorf("resolved params = %v", params)
	}
	if event.ID != "evt-1" || event.Type != "chat.command.hug" {
		t.Errorf("the run read %s/%s, want the command's own event", event.ID, event.Type)
	}
}

// The event an invocation announces must not start the command's workflow:
// the commander already runs it by id, so it would run twice.
func TestCommandWorkflowIsNotStartedByItsCommandEvent(t *testing.T) {
	h := newManualHarness(t, hugCommandWorkflow())
	listener := &types.WorkflowDefinition{
		ID:      "wf-listener",
		Name:    "reacts to !hug",
		Trigger: &types.TriggerConfig{Type: "event", Event: "chat.command.hug"},
		Tasks:   []types.TaskDefinition{{ID: "say", Type: "action", Action: "echo"}},
	}
	if err := h.engine.RegisterWorkflow(listener); err != nil {
		t.Fatalf("RegisterWorkflow: %v", err)
	}

	if matched := h.engine.Registry().GetByEvent("chat.command.hug"); len(matched) != 1 || matched[0].ID != "wf-listener" {
		ids := make([]string, len(matched))
		for i, wf := range matched {
			ids[i] = wf.ID
		}
		t.Fatalf("the command event matched %v, want only wf-listener", ids)
	}

	if err := h.engine.HandleEvent(hugEvent()); err != nil {
		t.Fatalf("HandleEvent: %v", err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for h.log.startedCount() < 1 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	// Give a wrongly dispatched second run the chance to show up.
	time.Sleep(50 * time.Millisecond)
	if started := h.log.startedCount(); started != 1 {
		t.Fatalf("the command event started %d runs, want 1 (the listener's)", started)
	}
}

func TestRunCommandRefusesAWorkflowThatIsNotACommands(t *testing.T) {
	h := newManualHarness(t, raidWorkflow())
	if _, _, err := h.engine.RunCommand(CommandRun{WorkflowID: "wf-raid", Event: hugEvent()}); err == nil {
		t.Fatal("an event-triggered workflow ran as a command's")
	}
	if _, _, err := h.engine.RunCommand(CommandRun{WorkflowID: "missing", Event: hugEvent()}); err == nil {
		t.Fatal("a missing workflow ran")
	}
	if started := h.log.startedCount(); started != 0 {
		t.Fatalf("a refused run started %d runs", started)
	}
}

func TestRunCommandRefusesAnotherCommandsEvent(t *testing.T) {
	h := newManualHarness(t, hugCommandWorkflow())
	event := hugEvent()
	event.Type = "chat.command.lurk"
	if _, _, err := h.engine.RunCommand(CommandRun{WorkflowID: "wf-hug", Event: event}); err == nil {
		t.Fatal("the !hug workflow ran on the !lurk event")
	}
	if started := h.log.startedCount(); started != 0 {
		t.Fatalf("a refused run started %d runs", started)
	}
}

func TestRunCommandHonoursTriggerConditions(t *testing.T) {
	h := newManualHarness(t, hugCommandWorkflow(
		types.ConditionConfig{Field: "${trigger.data.chatter}", Operator: "eq", Value: "someone else"},
	))
	outcome, executionID, err := h.engine.RunCommand(CommandRun{WorkflowID: "wf-hug", Event: hugEvent()})
	if err != nil {
		t.Fatalf("RunCommand: %v", err)
	}
	if outcome != CommandRunConditionsNotMet || executionID != "" {
		t.Fatalf("outcome %q, execution %q; want conditions_not_met and no run", outcome, executionID)
	}
}
