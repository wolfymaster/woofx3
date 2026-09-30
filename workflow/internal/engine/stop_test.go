package engine

import (
	"errors"
	"testing"
	"time"

	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// stopWithin runs Stop and fails the test if it takes longer than the bound:
// the service is killed if it outlives the orchestrator's grace period.
func stopWithin(t *testing.T, h *cancelHarness, bound time.Duration) {
	t.Helper()
	started := time.Now()
	if err := h.engine.Stop(); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	if took := time.Since(started); took > bound {
		t.Fatalf("Stop took %s, want under %s", took, bound)
	}
}

func TestStopLetsARunInFlightFinish(t *testing.T) {
	h := newCancelHarness(t)
	id := h.start(t, blockThenMark())
	h.awaitEntered(t)

	go func() {
		time.Sleep(30 * time.Millisecond)
		h.release <- struct{}{}
	}()
	stopWithin(t, h, 2*time.Second)

	if got := h.log.settlements(id); len(got) != 1 || got[0] != types.ExecutionStatusCompleted {
		t.Fatalf("settlements = %v, want [completed] by the time Stop returns", got)
	}
	if !h.didMark("after") {
		t.Error("the run did not finish its remaining step")
	}
}

func TestStopAbandonsARunThatOutlastsTheDrain(t *testing.T) {
	h := newCancelHarness(t)
	h.engine.stopDrainTimeout = 30 * time.Millisecond
	id := h.start(t, blockThenMark())
	h.awaitEntered(t)

	stopWithin(t, h, 2*time.Second)

	// Recorded by the time Stop returns, although the action never did.
	if got := h.log.settlements(id); len(got) != 1 || got[0] != types.ExecutionStatusFailed {
		t.Fatalf("settlements = %v, want [failed] by the time Stop returns", got)
	}
	execution, _ := h.engine.GetExecution(id)
	if execution.Error != "engine stopped" {
		t.Errorf("execution error = %q, want engine stopped", execution.Error)
	}
	step, ok := h.log.step("slow")
	if !ok || step.Status != string(types.TaskStatusCancelled) || step.Error != "engine stopped" {
		t.Errorf("slow step = %+v (recorded %v), want cancelled by the engine stopping", step, ok)
	}
	if h.didMark("after") {
		t.Error("the step after the abandoned one ran")
	}
	if !containsString(h.log.publishedTypes(), "workflow.run.failed") {
		t.Errorf("published %v, want workflow.run.failed", h.log.publishedTypes())
	}
}

// A run somebody cancelled stays cancelled, even when the engine stops before
// it has unwound.
func TestStopKeepsACancelledRunCancelled(t *testing.T) {
	h := newCancelHarness(t)
	h.engine.stopDrainTimeout = 30 * time.Millisecond
	id := h.start(t, blockThenMark())
	h.awaitEntered(t)

	if _, err := h.engine.Cancel(id, "stop it"); err != nil {
		t.Fatalf("Cancel: %v", err)
	}
	stopWithin(t, h, 2*time.Second)

	if got := h.log.settlements(id); len(got) != 1 || got[0] != types.ExecutionStatusCancelled {
		t.Fatalf("settlements = %v, want [cancelled]", got)
	}
}

func TestStopAbandonsAParentAndTheSubWorkflowItWaitsOn(t *testing.T) {
	h := newCancelHarness(t)
	h.engine.stopDrainTimeout = 30 * time.Millisecond
	child := &types.WorkflowDefinition{
		ID:    "wf-child",
		Name:  "child",
		Tasks: []types.TaskDefinition{{ID: "child-slow", Type: "action", Action: "block"}},
	}
	if err := h.engine.RegisterWorkflow(child); err != nil {
		t.Fatalf("RegisterWorkflow: %v", err)
	}
	parentID := h.start(t, &types.WorkflowDefinition{
		ID:   "wf-parent",
		Name: "parent",
		Tasks: []types.TaskDefinition{
			{ID: "call", Type: "workflow", Workflow: &types.WorkflowConfig{WorkflowID: "wf-child", WaitUntilCompletion: true}},
			{ID: "after", Type: "action", Action: "mark", DependsOn: []string{"call"}},
		},
	})
	h.awaitEntered(t)
	waitUntil(t, func() bool {
		h.engine.subWorkflowWaitersMu.Lock()
		defer h.engine.subWorkflowWaitersMu.Unlock()
		return len(h.engine.subWorkflowWaiters) == 1
	})

	stopWithin(t, h, 2*time.Second)

	h.engine.executionsMu.RLock()
	ids := make([]string, 0, len(h.engine.executions))
	for id := range h.engine.executions {
		ids = append(ids, id)
	}
	h.engine.executionsMu.RUnlock()
	if len(ids) != 2 {
		t.Fatalf("engine holds %d runs, want the parent and its sub-workflow", len(ids))
	}
	for _, id := range ids {
		if got := h.log.settlements(id); len(got) != 1 || got[0] != types.ExecutionStatusFailed {
			t.Errorf("run %s settlements = %v, want [failed]", id, got)
		}
		if execution, _ := h.engine.GetExecution(id); execution.Error != "engine stopped" {
			t.Errorf("run %s error = %q, want engine stopped", id, execution.Error)
		}
	}
	if h.didMark("after") {
		t.Error("the parent continued after the engine stopped")
	}
	if got := h.log.settlements(parentID); len(got) != 1 {
		t.Errorf("parent settled %d times, want once", len(got))
	}
}

func TestAStoppedEngineStartsNothing(t *testing.T) {
	h := newCancelHarness(t)
	wf := blockThenMark()
	wf.Trigger = &types.TriggerConfig{Type: "event", Event: "channel.raid"}
	if err := h.engine.RegisterWorkflow(wf); err != nil {
		t.Fatalf("RegisterWorkflow: %v", err)
	}
	stopWithin(t, h, time.Second)

	raid := &types.Event{ID: "raid-1", Type: "channel.raid", Source: "test", Time: time.Now(), Data: map[string]any{}}
	if err := h.engine.HandleEvent(raid); !errors.Is(err, errEngineStopped) {
		t.Errorf("HandleEvent = %v, want engine stopped", err)
	}
	if err := h.engine.FireByWorkflowID(wf.ID, raid); !errors.Is(err, errEngineStopped) {
		t.Errorf("FireByWorkflowID = %v, want engine stopped", err)
	}
	time.Sleep(50 * time.Millisecond)
	if h.log.startedCount() != 0 {
		t.Errorf("%d runs started in a stopped engine", h.log.startedCount())
	}
}
