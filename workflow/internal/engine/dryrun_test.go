package engine

import (
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// dryRunHarness counts real calls of its actions, so a test can tell an
// action that ran from one that only described itself.
type dryRunHarness struct {
	engine *Engine[execSvcs]
	log    *runLog
	mu     sync.Mutex
	calls  map[string]int
	dryRun map[string]bool // execution id -> DryRun as recorded at RunStarted
}

type dryRunRecorder struct {
	*runLog
	h *dryRunHarness
}

func (r dryRunRecorder) RunStarted(execution *types.WorkflowExecution) {
	r.h.mu.Lock()
	r.h.dryRun[execution.ID] = execution.DryRun
	r.h.mu.Unlock()
	r.runLog.RunStarted(execution)
}

func newDryRunHarness(t *testing.T) *dryRunHarness {
	t.Helper()
	h := &dryRunHarness{
		engine: newExecEngine(t),
		log:    newRunLog(),
		calls:  make(map[string]int),
		dryRun: make(map[string]bool),
	}
	h.engine.SetRunRecorder(dryRunRecorder{runLog: h.log, h: h})
	h.engine.SetPublisher(h.log)

	counting := func(name string) tasks.ActionFunc[execSvcs] {
		return func(ctx tasks.ActionContext[execSvcs], params map[string]any) (map[string]any, error) {
			h.mu.Lock()
			h.calls[name]++
			h.mu.Unlock()
			return map[string]any{"ran": name}, nil
		}
	}
	mustRegister(t, h.engine.RegisterAction("undescribed", counting("undescribed")))
	mustRegister(t, h.engine.RegisterActionWithSpec("shout", counting("shout"), tasks.ActionSpec{
		SideEffect: true,
		DryRun: func(params map[string]any) (string, error) {
			text, _ := params["text"].(string)
			if text == "" {
				return "", errors.New("text is required")
			}
			return "would shout " + text, nil
		},
	}))
	mustRegister(t, h.engine.RegisterActionWithSpec("pure", counting("pure"), tasks.ActionSpec{SideEffect: false}))
	return h
}

func mustRegister(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("register: %v", err)
	}
}

func (h *dryRunHarness) callCount(name string) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.calls[name]
}

func (h *dryRunHarness) run(t *testing.T, wf *types.WorkflowDefinition, dryRun bool) string {
	t.Helper()
	if _, err := h.engine.GetWorkflow(wf.ID); err != nil {
		mustRegister(t, h.engine.RegisterWorkflow(wf))
	}
	result, err := h.engine.RunManual(ManualRun{
		WorkflowID: wf.ID,
		Request:    &types.Event{ID: "req", Type: "workflow.execute", Time: time.Now(), TriggeredBy: "test"},
		DryRun:     dryRun,
	})
	if err != nil {
		t.Fatalf("RunManual: %v", err)
	}
	return result.ExecutionID
}

func threeKindsOfAction() *types.WorkflowDefinition {
	return &types.WorkflowDefinition{
		ID:   "wf-dry",
		Name: "dry",
		Tasks: []types.TaskDefinition{
			{ID: "a", Type: "action", Action: "undescribed", Parameters: map[string]any{"n": 1}},
			{ID: "b", Type: "action", Action: "shout", Parameters: map[string]any{"text": "hi"}, DependsOn: []string{"a"}},
			{ID: "c", Type: "action", Action: "pure", DependsOn: []string{"b"}},
		},
	}
}

func TestDryRunDescribesSideEffectsInsteadOfRunningThem(t *testing.T) {
	h := newDryRunHarness(t)
	id := h.run(t, threeKindsOfAction(), true)
	if status := h.log.awaitSettled(t, id); status != types.ExecutionStatusCompleted {
		t.Fatalf("settled %q, want completed", status)
	}

	if h.callCount("undescribed") != 0 || h.callCount("shout") != 0 {
		t.Errorf("side-effecting actions ran: %v", h.calls)
	}
	if h.callCount("pure") != 1 {
		t.Errorf("the side-effect-free action ran %d times, want 1", h.callCount("pure"))
	}

	// An action registered without a spec is treated as side-effecting and
	// gets the default sentence.
	a, _ := h.log.step("a")
	if a.Outputs["dryRun"] != true || a.Outputs["wouldDo"] != `would run undescribed with {"n":1}` {
		t.Errorf("a outputs = %v", a.Outputs)
	}
	b, _ := h.log.step("b")
	if b.Outputs["wouldDo"] != "would shout hi" || b.Status != string(types.TaskStatusSuccess) {
		t.Errorf("b = %+v", b)
	}

	h.mu.Lock()
	marked := h.dryRun[id]
	h.mu.Unlock()
	if !marked {
		t.Error("the run was recorded without its dry-run mark")
	}
}

func TestARealRunStillRunsEverything(t *testing.T) {
	h := newDryRunHarness(t)
	id := h.run(t, threeKindsOfAction(), false)
	h.log.awaitSettled(t, id)
	for _, name := range []string{"undescribed", "shout", "pure"} {
		if h.callCount(name) != 1 {
			t.Errorf("%s ran %d times, want 1", name, h.callCount(name))
		}
	}
}

// A dry run fails where the real run would, when the action's describer
// refuses the parameters.
func TestDryRunFailsOnParametersTheActionWouldRefuse(t *testing.T) {
	h := newDryRunHarness(t)
	id := h.run(t, &types.WorkflowDefinition{
		ID:    "wf-bad",
		Name:  "bad",
		Tasks: []types.TaskDefinition{{ID: "b", Type: "action", Action: "shout", Parameters: map[string]any{}}},
	}, true)
	if status := h.log.awaitSettled(t, id); status != types.ExecutionStatusFailed {
		t.Fatalf("settled %q, want failed", status)
	}
	execution, _ := h.engine.GetExecution(id)
	if !strings.Contains(execution.Error, "text is required") {
		t.Errorf("error = %q", execution.Error)
	}
}

func TestDryRunCompletesWaitsAtOnce(t *testing.T) {
	h := newDryRunHarness(t)
	id := h.run(t, &types.WorkflowDefinition{
		ID:   "wf-wait",
		Name: "wait",
		Tasks: []types.TaskDefinition{
			{ID: "hold", Type: "wait", Wait: &types.WaitConfig{Type: "event", Event: "channel.follow", Timeout: &types.Duration{Duration: time.Minute}}},
			{ID: "after", Type: "action", Action: "pure", DependsOn: []string{"hold"}},
		},
	}, true)
	if status := h.log.awaitSettled(t, id); status != types.ExecutionStatusCompleted {
		t.Fatalf("settled %q, want completed", status)
	}
	hold, _ := h.log.step("hold")
	if hold.Outputs["satisfied"] != true || hold.Outputs["dryRun"] != true {
		t.Errorf("hold outputs = %v", hold.Outputs)
	}
	if h.callCount("pure") != 1 {
		t.Error("the step after the wait did not run")
	}
	h.engine.waitingMu.RLock()
	armed := len(h.engine.waitingExecutions)
	h.engine.waitingMu.RUnlock()
	if armed != 0 {
		t.Error("a dry run armed a real wait")
	}
}

func TestDryRunWaitDescribesItself(t *testing.T) {
	got := describeWait(&types.WaitConfig{Event: "channel.follow", Timeout: &types.Duration{Duration: 2 * time.Minute}})
	if got != "would wait for a channel.follow event for up to 2m0s" {
		t.Errorf("describeWait = %q", got)
	}
}

func TestASubWorkflowOfADryRunIsDry(t *testing.T) {
	h := newDryRunHarness(t)
	mustRegister(t, h.engine.RegisterWorkflow(&types.WorkflowDefinition{
		ID:    "wf-child",
		Name:  "child",
		Tasks: []types.TaskDefinition{{ID: "child-shout", Type: "action", Action: "shout", Parameters: map[string]any{"text": "x"}}},
	}))
	id := h.run(t, &types.WorkflowDefinition{
		ID:   "wf-parent",
		Name: "parent",
		Tasks: []types.TaskDefinition{
			{ID: "call", Type: "workflow", Workflow: &types.WorkflowConfig{WorkflowID: "wf-child", WaitUntilCompletion: true}},
		},
	}, true)
	if status := h.log.awaitSettled(t, id); status != types.ExecutionStatusCompleted {
		t.Fatalf("settled %q, want completed", status)
	}
	if h.callCount("shout") != 0 {
		t.Error("the sub-workflow ran a side effect in a dry run")
	}
}

func TestDryRunDoesNotPublish(t *testing.T) {
	h := newDryRunHarness(t)
	id := h.run(t, &types.WorkflowDefinition{
		ID:    "wf-pub",
		Name:  "pub",
		Tasks: []types.TaskDefinition{{ID: "p", Type: "action", Action: "publish_event", Parameters: map[string]any{"eventType": "thing.happened"}}},
	}, true)
	h.log.awaitSettled(t, id)
	if containsString(h.log.publishedTypes(), "thing.happened") {
		t.Error("a dry run published its event")
	}
	p, _ := h.log.step("p")
	if p.Outputs["wouldDo"] != "would publish a thing.happened event" {
		t.Errorf("p outputs = %v", p.Outputs)
	}
}

// dryLoopback records events like runLog and hands each back to the engine,
// as the bus would deliver the engine's own lifecycle to its subscriptions.
type dryLoopback struct {
	*runLog
	engine *Engine[execSvcs]
}

func (p dryLoopback) Publish(event *types.Event) error {
	_ = p.runLog.Publish(event)
	return p.engine.HandleEvent(event)
}

// Workflow B runs when workflow A completes. A dry run of A must not make B
// run for real: A's lifecycle is stamped, and B starts as a dry run.
func TestADryRunsLifecycleStartsDependentWorkflowsAsDryRuns(t *testing.T) {
	h := newDryRunHarness(t)
	h.engine.SetPublisher(dryLoopback{runLog: h.log, engine: h.engine})
	mustRegister(t, h.engine.RegisterWorkflow(&types.WorkflowDefinition{
		ID:      "wf-b",
		Name:    "after A",
		Trigger: &types.TriggerConfig{Type: "event", Event: "workflow.run.completed"},
		Tasks:   []types.TaskDefinition{{ID: "b-shout", Type: "action", Action: "shout", Parameters: map[string]any{"text": "A finished"}}},
	}))

	idA := h.run(t, &types.WorkflowDefinition{
		ID:    "wf-a",
		Name:  "A",
		Tasks: []types.TaskDefinition{{ID: "a-pure", Type: "action", Action: "pure"}},
	}, true)
	h.log.awaitSettled(t, idA)

	var idB string
	waitUntil(t, func() bool {
		h.engine.executionsMu.RLock()
		defer h.engine.executionsMu.RUnlock()
		for execID, execution := range h.engine.executions {
			if execution.WorkflowID == "wf-b" {
				idB = execID
				return true
			}
		}
		return false
	})
	h.log.awaitSettled(t, idB)

	h.mu.Lock()
	bDry := h.dryRun[idB]
	h.mu.Unlock()
	if !bDry {
		t.Error("B was triggered by a dry run's completion but ran for real")
	}
	if h.callCount("shout") != 0 {
		t.Error("B called a side-effecting action")
	}
	b, _ := h.log.step("b-shout")
	if b.Outputs["wouldDo"] != "would shout A finished" {
		t.Errorf("b-shout outputs = %v", b.Outputs)
	}
}

func TestADryRunEventDoesNotResumeARealWait(t *testing.T) {
	h := newDryRunHarness(t)
	id := h.run(t, &types.WorkflowDefinition{
		ID:   "wf-real-wait",
		Name: "real wait",
		Tasks: []types.TaskDefinition{
			{ID: "hold", Type: "wait", Wait: &types.WaitConfig{Type: "event", Event: "workflow.run.completed"}},
			{ID: "after", Type: "action", Action: "pure", DependsOn: []string{"hold"}},
		},
	}, false)
	waitUntil(t, func() bool {
		h.engine.waitingMu.RLock()
		defer h.engine.waitingMu.RUnlock()
		return len(h.engine.waitingExecutions["workflow.run.completed"]) == 1
	})

	if err := h.engine.HandleEvent(&types.Event{ID: "dry", Type: "workflow.run.completed", Time: time.Now(), DryRun: true}); err != nil {
		t.Fatalf("HandleEvent: %v", err)
	}
	time.Sleep(20 * time.Millisecond)
	if h.callCount("pure") != 0 {
		t.Fatal("a dry run's event resumed a real run")
	}

	if err := h.engine.HandleEvent(&types.Event{ID: "real", Type: "workflow.run.completed", Time: time.Now()}); err != nil {
		t.Fatalf("HandleEvent: %v", err)
	}
	h.log.awaitSettled(t, id)
	if h.callCount("pure") != 1 {
		t.Error("the real event did not resume the wait")
	}
}

func TestDryRunWaitWithoutAnEvent(t *testing.T) {
	if got := describeWait(&types.WaitConfig{}); got != "would wait" {
		t.Errorf("describeWait = %q", got)
	}
}
