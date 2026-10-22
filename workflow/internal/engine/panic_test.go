package engine

import (
	"strings"
	"testing"
	"time"

	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// panicHarness is an engine with a run log, an `explode` action that panics
// and a `mark` action that returns, each registered workflow triggered by its
// own event type.
type panicHarness struct {
	engine *Engine[execSvcs]
	log    *runLog
}

func newPanicHarness(t *testing.T) *panicHarness {
	t.Helper()
	h := &panicHarness{engine: newExecEngine(t), log: newRunLog()}
	h.engine.SetRunRecorder(h.log)
	h.engine.SetPublisher(h.log)
	if err := h.engine.RegisterAction("explode", func(_ tasks.ActionContext[execSvcs], _ map[string]any) (map[string]any, error) {
		panic("explode action blew up")
	}); err != nil {
		t.Fatalf("RegisterAction: %v", err)
	}
	if err := h.engine.RegisterAction("mark", func(_ tasks.ActionContext[execSvcs], _ map[string]any) (map[string]any, error) {
		return map[string]any{"ok": true}, nil
	}); err != nil {
		t.Fatalf("RegisterAction: %v", err)
	}
	t.Cleanup(func() {
		if err := h.engine.Stop(); err != nil {
			t.Errorf("Stop: %v", err)
		}
	})
	return h
}

func (h *panicHarness) register(t *testing.T, id, eventType string, steps ...types.TaskDefinition) {
	t.Helper()
	if err := h.engine.RegisterWorkflow(&types.WorkflowDefinition{
		ID:      id,
		Name:    id,
		Trigger: &types.TriggerConfig{Type: "event", Event: eventType},
		Tasks:   steps,
	}); err != nil {
		t.Fatalf("RegisterWorkflow %s: %v", id, err)
	}
}

// fire hands the engine an event and returns the one run it began for
// workflowID, settled.
func (h *panicHarness) fire(t *testing.T, eventType, workflowID string) *types.WorkflowExecution {
	t.Helper()
	event := &types.Event{ID: eventType + "-1", Type: eventType, Source: "test", Time: time.Now(), Data: map[string]any{}}
	if err := h.engine.HandleEvent(event); err != nil {
		t.Fatalf("HandleEvent: %v", err)
	}
	executionID := h.runOf(t, workflowID)
	h.log.awaitSettled(t, executionID)
	execution, err := h.engine.GetExecution(executionID)
	if err != nil {
		t.Fatalf("GetExecution: %v", err)
	}
	return execution
}

func (h *panicHarness) runOf(t *testing.T, workflowID string) string {
	t.Helper()
	h.engine.executionsMu.RLock()
	defer h.engine.executionsMu.RUnlock()
	for id, execution := range h.engine.executions {
		if execution.WorkflowID == workflowID {
			return id
		}
	}
	t.Fatalf("no run begun for %s", workflowID)
	return ""
}

func (h *panicHarness) runCount(workflowID string) int {
	h.engine.executionsMu.RLock()
	defer h.engine.executionsMu.RUnlock()
	count := 0
	for _, execution := range h.engine.executions {
		if execution.WorkflowID == workflowID {
			count++
		}
	}
	return count
}

func TestPanickingActionFailsItsRunAndTheEngineCarriesOn(t *testing.T) {
	cases := []struct {
		name  string
		steps []types.TaskDefinition
	}{
		{
			name:  "sequential",
			steps: []types.TaskDefinition{{ID: "boom", Type: "action", Action: "explode"}},
		},
		{
			name: "concurrent",
			steps: []types.TaskDefinition{
				{ID: "boom", Type: "action", Action: "explode"},
				{ID: "sibling", Type: "action", Action: "mark"},
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := newPanicHarness(t)
			h.register(t, "wf-boom", "channel.cheer", tc.steps...)
			h.register(t, "wf-next", "channel.follow", types.TaskDefinition{ID: "next", Type: "action", Action: "mark"})

			failed := h.fire(t, "channel.cheer", "wf-boom")
			if failed.Status != types.ExecutionStatusFailed {
				t.Fatalf("panicking run status = %s, want failed", failed.Status)
			}
			if failed.Error != "internal error: panic in task boom" {
				t.Errorf("panicking run error = %q, want the panic reason", failed.Error)
			}
			step, ok := h.log.step("boom")
			if !ok || step.Status != string(types.TaskStatusFailed) || step.Error != "internal error: panic in task boom" {
				t.Errorf("boom step = %+v (recorded %v), want failed with the panic reason", step, ok)
			}
			if got := h.log.settlements(failed.ID); len(got) != 1 {
				t.Errorf("panicking run settled %v, want exactly once", got)
			}

			next := h.fire(t, "channel.follow", "wf-next")
			if next.Status != types.ExecutionStatusCompleted {
				t.Fatalf("next run status = %s (%s), want completed", next.Status, next.Error)
			}
		})
	}
}

// panickingStepRecorder is a run log whose StepSettled panics for one task, so
// a test can panic on whichever goroutine records that step.
type panickingStepRecorder struct {
	*runLog
	panicOn string
}

func (r *panickingStepRecorder) StepSettled(execution *types.WorkflowExecution, step RunStep) {
	if step.TaskID == r.panicOn {
		panic("recorder blew up")
	}
	r.runLog.StepSettled(execution, step)
}

// A delay settles on its timer's goroutine, which records the wait step and
// runs the rest of the run. A panic there fails the run instead of the process.
func TestPanicOnAWaitTimerFailsItsRun(t *testing.T) {
	e := newExecEngine(t)
	recorder := &panickingStepRecorder{runLog: newRunLog(), panicOn: "pause"}
	e.SetRunRecorder(recorder)
	if err := e.RegisterAction("mark", func(_ tasks.ActionContext[execSvcs], _ map[string]any) (map[string]any, error) {
		return map[string]any{"ok": true}, nil
	}); err != nil {
		t.Fatalf("RegisterAction: %v", err)
	}
	t.Cleanup(func() {
		if err := e.Stop(); err != nil {
			t.Errorf("Stop: %v", err)
		}
	})
	def := &types.WorkflowDefinition{
		ID:      "wf-delay",
		Name:    "delay",
		Trigger: &types.TriggerConfig{Type: "event", Event: "channel.raid"},
		Tasks: []types.TaskDefinition{
			{ID: "pause", Type: "wait", Wait: &types.WaitConfig{Type: tasks.WaitTypeDelay, DurationMs: 20}},
			{ID: "after", Type: "action", Action: "mark", DependsOn: []string{"pause"}},
		},
	}
	trigger := &types.Event{ID: "raid-1", Type: "channel.raid", Source: "test", Time: time.Now(), Data: map[string]any{}}
	e.startRun(def, trigger, e.newViewerLoader(viewerTrigger(def), trigger))

	var executionID string
	waitUntil(t, func() bool {
		recorder.mu.Lock()
		defer recorder.mu.Unlock()
		if len(recorder.started) == 0 {
			return false
		}
		executionID = recorder.started[0]
		return true
	})
	if status := recorder.awaitSettled(t, executionID); status != types.ExecutionStatusFailed {
		t.Fatalf("status = %s, want failed", status)
	}
	execution, err := e.GetExecution(executionID)
	if err != nil {
		t.Fatalf("GetExecution: %v", err)
	}
	if execution.Error != "internal error: panic in wait timer" {
		t.Errorf("error = %q, want the panic on the wait timer", execution.Error)
	}
	if _, ran := recorder.step("after"); ran {
		t.Error("the step after the panic ran")
	}
}

func TestSubWorkflowParametersThatDoNotResolveFailTheTask(t *testing.T) {
	cases := []struct {
		name string
		call types.TaskDefinition
		want string
	}{
		{
			name: "parameters form, unresolvable eventData",
			call: types.TaskDefinition{ID: "call", Type: "workflow", Parameters: map[string]any{
				"workflowId": "wf-child",
				"eventData":  map[string]any{"user": "${trigger.data.missing}"},
			}},
			want: "resolve sub-workflow parameters: failed to resolve eventData",
		},
		{
			name: "parameters form, wrong type",
			call: types.TaskDefinition{ID: "call", Type: "workflow", Parameters: map[string]any{
				"workflowId":          "wf-child",
				"waitUntilCompletion": "yes",
			}},
			want: `sub-workflow parameter "waitUntilCompletion" must be a boolean`,
		},
		{
			name: "parameters form, no workflowId",
			call: types.TaskDefinition{ID: "call", Type: "workflow", Parameters: map[string]any{"event": "child.run"}},
			want: "workflow task missing workflowId",
		},
		{
			name: "workflow block, unresolvable eventData",
			call: types.TaskDefinition{ID: "call", Type: "workflow", Workflow: &types.WorkflowConfig{
				WorkflowID: "wf-child",
				EventData:  map[string]any{"user": "${trigger.data.missing}"},
			}},
			want: "resolve sub-workflow eventData: failed to resolve user",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := newPanicHarness(t)
			h.register(t, "wf-child", "child.run", types.TaskDefinition{ID: "child-mark", Type: "action", Action: "mark"})
			h.register(t, "wf-parent", "channel.cheer", tc.call)

			execution := h.fire(t, "channel.cheer", "wf-parent")
			if execution.Status != types.ExecutionStatusFailed {
				t.Fatalf("status = %s, want failed", execution.Status)
			}
			if !strings.Contains(execution.Error, tc.want) {
				t.Errorf("run error = %q, want it to contain %q", execution.Error, tc.want)
			}
			step, ok := h.log.step("call")
			if !ok || step.Status != string(types.TaskStatusFailed) || !strings.Contains(step.Error, tc.want) {
				t.Errorf("call step = %+v (recorded %v), want failed with %q", step, ok, tc.want)
			}
			if n := h.runCount("wf-child"); n != 0 {
				t.Errorf("sub-workflow ran %d times, want 0", n)
			}
		})
	}
}

// Sub-workflow parameters resolve once: text that only looks like an
// expression after resolving, such as a chat message, reaches the sub-workflow
// as written.
func TestSubWorkflowParametersResolveOnce(t *testing.T) {
	h := newPanicHarness(t)
	h.register(t, "wf-child", "child.run", types.TaskDefinition{ID: "child-mark", Type: "action", Action: "mark"})
	h.register(t, "wf-parent", "channel.chat", types.TaskDefinition{ID: "call", Type: "workflow", Parameters: map[string]any{
		"workflowId": "wf-child",
		"eventData":  map[string]any{"message": "${trigger.data.message}"},
	}})

	event := &types.Event{ID: "chat-1", Type: "channel.chat", Source: "test", Time: time.Now(), Data: map[string]any{"message": "${trigger.id}"}}
	if err := h.engine.HandleEvent(event); err != nil {
		t.Fatalf("HandleEvent: %v", err)
	}
	parentID := h.runOf(t, "wf-parent")
	if status := h.log.awaitSettled(t, parentID); status != types.ExecutionStatusCompleted {
		t.Fatalf("parent status = %s, want completed", status)
	}
	child, err := h.engine.GetExecution(h.runOf(t, "wf-child"))
	if err != nil {
		t.Fatalf("GetExecution: %v", err)
	}
	if got := child.TriggerEvent.Data["message"]; got != "${trigger.id}" {
		t.Errorf("sub-workflow message = %v, want the chat text as written", got)
	}
}
