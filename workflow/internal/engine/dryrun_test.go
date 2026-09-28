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
