package engine

import (
	"sync"
	"testing"
	"time"

	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// stepRecorder keeps every settled step so a test can read the run history the
// engine would have persisted.
type stepRecorder struct {
	mu    sync.Mutex
	steps map[string]RunStep
}

func (r *stepRecorder) RunStarted(string, *types.WorkflowExecution) {}
func (r *stepRecorder) RunSettled(string, *types.WorkflowExecution) {}
func (r *stepRecorder) StepSettled(_ string, _ *types.WorkflowExecution, step RunStep) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.steps[step.TaskID] = step
}

// disabledHarness runs an execution order against an engine whose `mark`
// action records which tasks it ran.
type disabledHarness struct {
	engine   *Engine[execSvcs]
	recorder *stepRecorder
	mu       sync.Mutex
	ran      map[string]bool
}

func newDisabledHarness(t *testing.T) *disabledHarness {
	t.Helper()
	h := &disabledHarness{
		engine:   newExecEngine(t),
		recorder: &stepRecorder{steps: make(map[string]RunStep)},
		ran:      make(map[string]bool),
	}
	h.engine.SetRunRecorder(h.recorder)
	if err := h.engine.RegisterAction("mark", func(ctx tasks.ActionContext[execSvcs], params map[string]any) (map[string]any, error) {
		id, ok := params["id"].(string)
		if !ok {
			t.Errorf("mark called without an id: %v", params)
		}
		h.mu.Lock()
		h.ran[id] = true
		h.mu.Unlock()
		return map[string]any{"ok": true}, nil
	}); err != nil {
		t.Fatalf("RegisterAction: %v", err)
	}
	return h
}

func (h *disabledHarness) run(order []*types.TaskDefinition) *types.WorkflowExecution {
	execution := &types.WorkflowExecution{
		ID:         "exec-disabled",
		WorkflowID: "wf-disabled",
		Status:     types.ExecutionStatusRunning,
		Tasks:      make(map[string]*types.TaskExecution),
		StartedAt:  time.Now(),
	}
	event := &types.Event{ID: "e1", Type: "channel.cheer", Source: "test", Time: time.Now(), Data: map[string]any{"bits": 500}}
	h.engine.executeTasksFromIndex(execution, order, 0, make(map[string]map[string]any), event)
	return execution
}

func (h *disabledHarness) didRun(id string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.ran[id]
}

func markTask(id string, dependsOn ...string) *types.TaskDefinition {
	return &types.TaskDefinition{
		ID:         id,
		Type:       "action",
		Action:     "mark",
		DependsOn:  dependsOn,
		Parameters: map[string]any{"id": id},
	}
}

// A trigger workflow: a condition that matches the event, the branches it
// chooses between, and guards reading its result. `disabled` switches the
// condition off.
func triggerWorkflow(disabled bool) []*types.TaskDefinition {
	cond := &types.TaskDefinition{
		ID:        "rule",
		Type:      "condition",
		Disabled:  disabled,
		Condition: &types.ConditionConfig{Field: "${trigger.data.bits}", Operator: "gte", Value: 100},
		OnTrue:    []string{"matched"},
		OnFalse:   []string{"unmatched"},
	}
	whenTrue := markTask("guard_true", "rule")
	whenTrue.Condition = &types.ConditionConfig{Field: "${rule.result}", Operator: "eq", Value: true}
	whenFalse := markTask("guard_false", "rule")
	whenFalse.Condition = &types.ConditionConfig{Field: "${rule.result}", Operator: "eq", Value: false}
	return []*types.TaskDefinition{
		cond,
		markTask("matched", "rule"),
		markTask("unmatched", "rule"),
		whenTrue,
		whenFalse,
	}
}

func assertCompleted(t *testing.T, execution *types.WorkflowExecution) {
	t.Helper()
	if execution.Status != types.ExecutionStatusCompleted {
		t.Fatalf("status = %v, want completed (error: %q)", execution.Status, execution.Error)
	}
}

func TestADisabledConditionSkipsItsOnTrueBranch(t *testing.T) {
	h := newDisabledHarness(t)
	execution := h.run(triggerWorkflow(true))
	assertCompleted(t, execution)

	if h.didRun("matched") {
		t.Error("onTrue task ran behind a disabled condition whose conditions would have matched")
	}
	if got := execution.Tasks["matched"].Status; got != types.TaskStatusSkipped {
		t.Errorf("onTrue status = %v, want skipped", got)
	}
	if !h.didRun("unmatched") {
		t.Error("onFalse task did not run; a disabled condition resolves as false")
	}

	rule := execution.Tasks["rule"]
	if rule.Status != types.TaskStatusSuccess {
		t.Errorf("condition status = %v, want success", rule.Status)
	}
	if rule.Result.Exports["result"] != false {
		t.Errorf("condition result = %v, want false", rule.Result.Exports["result"])
	}
	if rule.Result.Data["disabled"] != true {
		t.Errorf("condition data does not say it was disabled: %v", rule.Result.Data)
	}
}

func TestAGuardOnADisabledConditionSeesFalse(t *testing.T) {
	h := newDisabledHarness(t)
	execution := h.run(triggerWorkflow(true))
	assertCompleted(t, execution)

	if h.didRun("guard_true") {
		t.Error("a guard requiring ${rule.result} == true ran")
	}
	if !h.didRun("guard_false") {
		t.Error("a guard requiring ${rule.result} == false did not run")
	}
}

// The recorded step is what a resume re-derives the skipped branch from, so it
// must read exactly like a condition that evaluated false.
func TestADisabledConditionIsRecordedAsAFalseResult(t *testing.T) {
	h := newDisabledHarness(t)
	assertCompleted(t, h.run(triggerWorkflow(true)))

	step, ok := h.recorder.steps["rule"]
	if !ok {
		t.Fatal("the disabled condition was not recorded")
	}
	if step.Status != string(types.TaskStatusSuccess) || step.Outputs["result"] != false {
		t.Errorf("recorded %s with outputs %v, want success with result false", step.Status, step.Outputs)
	}
	if got := h.recorder.steps["matched"].Status; got != string(types.TaskStatusSkipped) {
		t.Errorf("onTrue recorded as %q, want skipped", got)
	}
}

func TestADisabledActionIsSkippedAndRecorded(t *testing.T) {
	h := newDisabledHarness(t)
	off := markTask("off")
	off.Disabled = true
	// A guard that would fail to resolve proves the guard is not evaluated.
	off.Condition = &types.ConditionConfig{Field: "${missing.value}", Operator: "eq", Value: 1}
	after := markTask("after", "off")

	execution := h.run([]*types.TaskDefinition{off, after})
	assertCompleted(t, execution)

	if h.didRun("off") {
		t.Error("a disabled action ran")
	}
	if got := execution.Tasks["off"].Status; got != types.TaskStatusSkipped {
		t.Errorf("disabled action status = %v, want skipped", got)
	}
	if got := h.recorder.steps["off"].Status; got != string(types.TaskStatusSkipped) {
		t.Errorf("disabled action recorded as %q, want skipped", got)
	}
	if !h.didRun("after") {
		t.Error("a task depending on a disabled one did not run; skips are not transitive")
	}
}

// Independent actions take the concurrent path, which settles each task on its
// own; a disabled one must be skipped there too.
func TestADisabledActionInAConcurrentRunIsSkipped(t *testing.T) {
	h := newDisabledHarness(t)
	off := markTask("off")
	off.Disabled = true
	on := markTask("on")

	execution := h.run([]*types.TaskDefinition{off, on})
	assertCompleted(t, execution)

	if h.didRun("off") {
		t.Error("a disabled action ran in a concurrent run")
	}
	if got := h.recorder.steps["off"].Status; got != string(types.TaskStatusSkipped) {
		t.Errorf("disabled action recorded as %q, want skipped", got)
	}
	if !h.didRun("on") {
		t.Error("the enabled sibling did not run")
	}
}

func TestAnEnabledWorkflowIsUnchanged(t *testing.T) {
	h := newDisabledHarness(t)
	execution := h.run(triggerWorkflow(false))
	assertCompleted(t, execution)

	for id, want := range map[string]bool{
		"matched":     true,
		"unmatched":   false,
		"guard_true":  true,
		"guard_false": false,
	} {
		if got := h.didRun(id); got != want {
			t.Errorf("%s ran = %v, want %v", id, got, want)
		}
	}
	rule := execution.Tasks["rule"].Result
	if rule.Exports["result"] != true {
		t.Errorf("condition result = %v, want true", rule.Exports["result"])
	}
	if _, marked := rule.Data["disabled"]; marked {
		t.Errorf("an enabled condition was marked disabled: %v", rule.Data)
	}
}
