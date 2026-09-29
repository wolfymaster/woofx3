package engine

import (
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// manualHarness runs workflows through RunManual with an `echo` action that
// captures the parameters it was resolved with.
type manualHarness struct {
	engine *Engine[execSvcs]
	log    *runLog
	mu     sync.Mutex
	echoed map[string]any
	event  *types.Event
}

func newManualHarness(t *testing.T, wf *types.WorkflowDefinition) *manualHarness {
	t.Helper()
	h := &manualHarness{engine: newExecEngine(t), log: newRunLog()}
	h.engine.SetRunRecorder(h.log)
	if err := h.engine.RegisterAction("echo", func(ctx tasks.ActionContext[execSvcs], params map[string]any) (map[string]any, error) {
		h.mu.Lock()
		h.echoed = params
		h.event = ctx.TriggerEvent
		h.mu.Unlock()
		return params, nil
	}); err != nil {
		t.Fatalf("RegisterAction: %v", err)
	}
	if err := h.engine.RegisterWorkflow(wf); err != nil {
		t.Fatalf("RegisterWorkflow: %v", err)
	}
	return h
}

func (h *manualHarness) captured() (map[string]any, *types.Event) {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.echoed, h.event
}

func raidWorkflow(conditions ...types.ConditionConfig) *types.WorkflowDefinition {
	return &types.WorkflowDefinition{
		ID:   "wf-raid",
		Name: "raid shoutout",
		Trigger: &types.TriggerConfig{
			Type:       "event",
			Event:      "channel.raid",
			Conditions: conditions,
		},
		Tasks: []types.TaskDefinition{{
			ID:     "say",
			Type:   "action",
			Action: "echo",
			Parameters: map[string]any{
				"who":      "${trigger.data.fromBroadcasterName}",
				"viewers":  "${trigger.data.viewers}",
				"platform": "${trigger.platform}",
			},
		}},
	}
}

func manualRequest() *types.Event {
	return &types.Event{
		ID:          "req-1",
		Type:        "workflow.execute",
		Source:      "api",
		Time:        time.Now(),
		TriggerID:   "corr-1",
		TriggeredBy: "test",
		Data:        map[string]any{"workflowId": "wf-raid", "inputs": map[string]any{}},
	}
}

func TestManualRunResolvesSampleTriggerData(t *testing.T) {
	h := newManualHarness(t, raidWorkflow())

	result, err := h.engine.RunManual(ManualRun{
		WorkflowID:  "wf-raid",
		Request:     manualRequest(),
		TriggerData: map[string]any{"fromBroadcasterName": "wolfy", "viewers": 42},
		Platform:    "twitch",
	})
	if err != nil {
		t.Fatalf("RunManual: %v", err)
	}
	if result.Outcome != ManualRunStarted || result.ExecutionID == "" {
		t.Fatalf("result = %+v, want started with an execution id", result)
	}
	if result.EventType != "channel.raid" {
		t.Errorf("event type = %q, want the trigger's channel.raid", result.EventType)
	}
	if status := h.log.awaitSettled(t, result.ExecutionID); status != types.ExecutionStatusCompleted {
		t.Fatalf("settled %q, want completed", status)
	}

	params, event := h.captured()
	if params["who"] != "wolfy" || params["viewers"] != 42 || params["platform"] != "twitch" {
		t.Errorf("resolved params = %v", params)
	}
	if event.Type != "channel.raid" {
		t.Errorf("trigger type = %q, want channel.raid", event.Type)
	}
	if _, leaked := event.Data["workflowId"]; leaked {
		t.Error("the execute request's own data leaked into trigger.data")
	}
	// Correlation survives, so the caller still hears how the run ended and
	// the recorder still sees the origin.
	if event.TriggerID != "corr-1" || event.TriggeredBy != "test" {
		t.Errorf("correlation = %q/%q", event.TriggerID, event.TriggeredBy)
	}
}

func TestManualRunReportsUnmetConditions(t *testing.T) {
	h := newManualHarness(t, raidWorkflow(
		types.ConditionConfig{Field: "${trigger.data.viewers}", Operator: "gte", Value: 10},
		types.ConditionConfig{Field: "${trigger.platform}", Operator: "eq", Value: "twitch"},
		types.ConditionConfig{Field: "${trigger.data.fromBroadcasterName}", Operator: "eq", Value: "wolfy"},
	))

	result, err := h.engine.RunManual(ManualRun{
		WorkflowID:  "wf-raid",
		Request:     manualRequest(),
		TriggerData: map[string]any{"fromBroadcasterName": "wolfy", "viewers": 3},
	})
	if err != nil {
		t.Fatalf("RunManual: %v", err)
	}
	if result.Outcome != ManualRunConditionsNotMet {
		t.Fatalf("outcome = %q, want conditions_not_met", result.Outcome)
	}
	if result.ExecutionID != "" {
		t.Errorf("a refused run has execution id %q", result.ExecutionID)
	}
	// Every failing condition is named, not just the first.
	if len(result.Unmet) != 2 {
		t.Fatalf("unmet = %+v, want viewers and platform", result.Unmet)
	}
	if result.Unmet[0].Field != "${trigger.data.viewers}" || result.Unmet[1].Field != "${trigger.platform}" {
		t.Errorf("unmet = %+v", result.Unmet)
	}
	if h.log.startedCount() != 0 {
		t.Error("a run was started although its conditions were not met")
	}
}

func TestManualRunCanSkipConditions(t *testing.T) {
	h := newManualHarness(t, raidWorkflow(
		types.ConditionConfig{Field: "${trigger.data.viewers}", Operator: "gte", Value: 10},
	))

	result, err := h.engine.RunManual(ManualRun{
		WorkflowID:     "wf-raid",
		Request:        manualRequest(),
		TriggerData:    map[string]any{"viewers": 3},
		SkipConditions: true,
	})
	if err != nil {
		t.Fatalf("RunManual: %v", err)
	}
	if result.Outcome != ManualRunStarted {
		t.Fatalf("outcome = %q, want started", result.Outcome)
	}
	h.log.awaitSettled(t, result.ExecutionID)
}

func TestManualRunMatchingConditionsStarts(t *testing.T) {
	h := newManualHarness(t, raidWorkflow(
		types.ConditionConfig{Field: "${trigger.data.viewers}", Operator: "gte", Value: 10},
	))

	result, err := h.engine.RunManual(ManualRun{
		WorkflowID:  "wf-raid",
		Request:     manualRequest(),
		TriggerData: map[string]any{"viewers": 25},
	})
	if err != nil || result.Outcome != ManualRunStarted {
		t.Fatalf("RunManual = %+v, %v; want started", result, err)
	}
	h.log.awaitSettled(t, result.ExecutionID)
}

// Without sample data the run starts from the request as it always has, and
// trigger conditions -- which could only ever read the request -- are not
// consulted.
func TestManualRunWithoutSampleDataKeepsTheRequestEvent(t *testing.T) {
	wf := raidWorkflow(types.ConditionConfig{Field: "${trigger.data.viewers}", Operator: "gte", Value: 10})
	wf.Tasks[0].Parameters = map[string]any{"type": "${trigger.type}"}
	h := newManualHarness(t, wf)

	result, err := h.engine.RunManual(ManualRun{WorkflowID: "wf-raid", Request: manualRequest()})
	if err != nil || result.Outcome != ManualRunStarted {
		t.Fatalf("RunManual = %+v, %v; want started", result, err)
	}
	if status := h.log.awaitSettled(t, result.ExecutionID); status != types.ExecutionStatusCompleted {
		t.Fatalf("settled %q, want completed", status)
	}

	_, event := h.captured()
	if event.Type != "workflow.execute" || event.Data["workflowId"] != "wf-raid" {
		t.Errorf("trigger = %s %v, want the request event unchanged", event.Type, event.Data)
	}
}

func TestManualRunRefusesOversizedSampleData(t *testing.T) {
	h := newManualHarness(t, raidWorkflow())

	_, err := h.engine.RunManual(ManualRun{
		WorkflowID:  "wf-raid",
		Request:     manualRequest(),
		TriggerData: map[string]any{"blob": strings.Repeat("x", MaxTriggerDataBytes)},
	})
	if err == nil || !strings.Contains(err.Error(), "byte limit") {
		t.Fatalf("err = %v, want a size refusal", err)
	}
	if h.log.startedCount() != 0 {
		t.Error("an oversized sample started a run")
	}
}

func TestManualRunRefusesAnUnknownWorkflow(t *testing.T) {
	h := newManualHarness(t, raidWorkflow())
	if _, err := h.engine.RunManual(ManualRun{WorkflowID: "missing", Request: manualRequest()}); err == nil {
		t.Fatal("RunManual accepted a workflow the registry does not hold")
	}
}
