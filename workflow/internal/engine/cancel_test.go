package engine

import (
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// runLog records what the engine reported about runs, safely across the
// goroutines runs execute on.
type runLog struct {
	mu        sync.Mutex
	started   []string
	settled   map[string][]types.ExecutionStatus
	steps     map[string]RunStep
	published []string
	settledCh chan string
}

func newRunLog() *runLog {
	return &runLog{
		settled:   make(map[string][]types.ExecutionStatus),
		steps:     make(map[string]RunStep),
		settledCh: make(chan string, 64),
	}
}

func (l *runLog) RunStarted(execution *types.WorkflowExecution) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.started = append(l.started, execution.ID)
}

func (l *runLog) RunSettled(execution *types.WorkflowExecution) {
	l.mu.Lock()
	l.settled[execution.ID] = append(l.settled[execution.ID], execution.Status)
	l.mu.Unlock()
	l.settledCh <- execution.ID
}

func (l *runLog) StepSettled(_ *types.WorkflowExecution, step RunStep) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.steps[step.TaskID] = step
}

func (l *runLog) Publish(event *types.Event) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.published = append(l.published, event.Type)
	return nil
}

func (l *runLog) settlements(executionID string) []types.ExecutionStatus {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]types.ExecutionStatus(nil), l.settled[executionID]...)
}

func (l *runLog) step(taskID string) (RunStep, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	step, ok := l.steps[taskID]
	return step, ok
}

func (l *runLog) publishedTypes() []string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]string(nil), l.published...)
}

func (l *runLog) startedCount() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.started)
}

// awaitSettled blocks until the run settles, or fails the test.
func (l *runLog) awaitSettled(t *testing.T, executionID string) types.ExecutionStatus {
	t.Helper()
	deadline := time.After(5 * time.Second)
	for {
		if got := l.settlements(executionID); len(got) > 0 {
			return got[0]
		}
		select {
		case <-l.settledCh:
		case <-deadline:
			t.Fatalf("run %s did not settle", executionID)
		}
	}
}

// cancelHarness is an engine with a recorder and publisher, a `block` action
// that signals when it starts and then ignores its context until released, and
// a `mark` action that notes it ran.
type cancelHarness struct {
	engine  *Engine[execSvcs]
	log     *runLog
	entered chan string
	release chan struct{}
	mu      sync.Mutex
	marked  map[string]bool
}

func newCancelHarness(t *testing.T) *cancelHarness {
	t.Helper()
	h := &cancelHarness{
		engine:  newExecEngine(t),
		log:     newRunLog(),
		entered: make(chan string, 16),
		release: make(chan struct{}),
		marked:  make(map[string]bool),
	}
	h.engine.SetRunRecorder(h.log)
	h.engine.SetPublisher(h.log)
	t.Cleanup(func() { close(h.release) })

	if err := h.engine.RegisterAction("block", func(ctx tasks.ActionContext[execSvcs], params map[string]any) (map[string]any, error) {
		h.entered <- ctx.TaskID
		<-h.release
		return map[string]any{"released": true}, nil
	}); err != nil {
		t.Fatalf("RegisterAction: %v", err)
	}
	if err := h.engine.RegisterAction("mark", func(ctx tasks.ActionContext[execSvcs], params map[string]any) (map[string]any, error) {
		h.mu.Lock()
		h.marked[ctx.TaskID] = true
		h.mu.Unlock()
		return map[string]any{"ok": true}, nil
	}); err != nil {
		t.Fatalf("RegisterAction: %v", err)
	}
	return h
}

func (h *cancelHarness) didMark(taskID string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.marked[taskID]
}

func (h *cancelHarness) awaitEntered(t *testing.T) string {
	t.Helper()
	select {
	case id := <-h.entered:
		return id
	case <-time.After(5 * time.Second):
		t.Fatal("blocking action never started")
		return ""
	}
}

// start registers the workflow and runs it through RunManual, returning the
// execution id.
func (h *cancelHarness) start(t *testing.T, wf *types.WorkflowDefinition) string {
	t.Helper()
	if err := h.engine.RegisterWorkflow(wf); err != nil {
		t.Fatalf("RegisterWorkflow: %v", err)
	}
	result, err := h.engine.RunManual(ManualRun{
		WorkflowID: wf.ID,
		Request:    &types.Event{ID: "req-1", Type: "workflow.execute", Source: "test", Time: time.Now(), TriggerID: "corr-1"},
	})
	if err != nil {
		t.Fatalf("RunManual: %v", err)
	}
	if result.ExecutionID == "" {
		t.Fatalf("RunManual returned no execution id: %+v", result)
	}
	return result.ExecutionID
}

func (h *cancelHarness) startUnvalidated(t *testing.T, wf *types.WorkflowDefinition) string {
	t.Helper()
	h.engine.workflowRegistry.mu.Lock()
	h.engine.workflowRegistry.workflows[wf.ID] = wf
	h.engine.workflowRegistry.mu.Unlock()
	result, err := h.engine.RunManual(ManualRun{
		WorkflowID: wf.ID,
		Request:    &types.Event{ID: "req-1", Type: "workflow.execute", Source: "test", Time: time.Now(), TriggerID: "corr-1"},
	})
	if err != nil || result.ExecutionID == "" {
		t.Fatalf("RunManual: %+v, %v", result, err)
	}
	return result.ExecutionID
}

func (h *cancelHarness) waitCount(eventType string) int {
	h.engine.waitingMu.RLock()
	defer h.engine.waitingMu.RUnlock()
	return len(h.engine.waitingExecutions[eventType])
}

func blockThenMark() *types.WorkflowDefinition {
	return &types.WorkflowDefinition{
		ID:   "wf-block",
		Name: "block then mark",
		Tasks: []types.TaskDefinition{
			{ID: "slow", Type: "action", Action: "block"},
			{ID: "after", Type: "action", Action: "mark", DependsOn: []string{"slow"}},
		},
	}
}

func TestCancelAbandonsTheTaskInFlight(t *testing.T) {
	h := newCancelHarness(t)
	id := h.start(t, blockThenMark())
	h.awaitEntered(t)

	result, err := h.engine.Cancel(id, "stop it")
	if err != nil {
		t.Fatalf("Cancel: %v", err)
	}
	if result.Outcome != CancelOutcomeCancelled || result.Status != types.ExecutionStatusCancelled {
		t.Fatalf("Cancel = %+v, want cancelled", result)
	}

	// Settles although the action never returns: the engine stops waiting.
	if status := h.log.awaitSettled(t, id); status != types.ExecutionStatusCancelled {
		t.Fatalf("settled %q, want cancelled", status)
	}
	if h.didMark("after") {
		t.Error("the task after the cancelled one ran")
	}
	step, ok := h.log.step("slow")
	if !ok || step.Status != string(types.TaskStatusCancelled) {
		t.Errorf("slow step = %+v (recorded %v), want cancelled", step, ok)
	}

	execution, _ := h.engine.GetExecution(id)
	if execution.Error != "cancelled: stop it" {
		t.Errorf("execution error = %q", execution.Error)
	}
	if !containsString(h.log.publishedTypes(), "workflow.run.cancelled") {
		t.Errorf("published %v, want workflow.run.cancelled", h.log.publishedTypes())
	}
}

func TestCancelHandsTheActionADoneContext(t *testing.T) {
	h := newCancelHarness(t)
	observed := make(chan error, 1)
	if err := h.engine.RegisterAction("honour", func(ctx tasks.ActionContext[execSvcs], params map[string]any) (map[string]any, error) {
		h.entered <- ctx.TaskID
		<-ctx.Context.Done()
		observed <- ctx.Context.Err()
		return nil, ctx.Context.Err()
	}); err != nil {
		t.Fatalf("RegisterAction: %v", err)
	}
	id := h.start(t, &types.WorkflowDefinition{
		ID:    "wf-honour",
		Name:  "honour",
		Tasks: []types.TaskDefinition{{ID: "a", Type: "action", Action: "honour"}},
	})
	h.awaitEntered(t)

	if _, err := h.engine.Cancel(id, ""); err != nil {
		t.Fatalf("Cancel: %v", err)
	}
	select {
	case err := <-observed:
		if err == nil {
			t.Error("context reported no error after cancel")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the action's context was never done")
	}
	if status := h.log.awaitSettled(t, id); status != types.ExecutionStatusCancelled {
		t.Fatalf("settled %q, want cancelled", status)
	}
}

func TestCancelClaimsAPendingWait(t *testing.T) {
	h := newCancelHarness(t)
	id := h.start(t, &types.WorkflowDefinition{
		ID:   "wf-wait",
		Name: "wait",
		Tasks: []types.TaskDefinition{
			{ID: "hold", Type: "wait", Wait: &types.WaitConfig{Type: "event", Event: "test.never"}},
			{ID: "after", Type: "action", Action: "mark", DependsOn: []string{"hold"}},
		},
	})
	waitUntil(t, func() bool { return h.waitCount("test.never") == 1 })

	if _, err := h.engine.Cancel(id, "no more waiting"); err != nil {
		t.Fatalf("Cancel: %v", err)
	}

	// A paused run has no goroutine to notice the cancel, so Cancel settles
	// it before returning.
	if got := h.log.settlements(id); len(got) != 1 || got[0] != types.ExecutionStatusCancelled {
		t.Fatalf("settlements = %v, want [cancelled]", got)
	}
	if h.waitCount("test.never") != 0 {
		t.Error("the cancelled wait is still armed")
	}
	step, ok := h.log.step("hold")
	if !ok || step.Status != string(types.TaskStatusCancelled) {
		t.Errorf("hold step = %+v (recorded %v), want cancelled", step, ok)
	}

	// The event the wait was for now resumes nothing.
	if err := h.engine.HandleEvent(&types.Event{ID: "late", Type: "test.never", Time: time.Now()}); err != nil {
		t.Fatalf("HandleEvent: %v", err)
	}
	time.Sleep(50 * time.Millisecond)
	if h.didMark("after") {
		t.Error("a cancelled wait resumed its run")
	}
}

func TestCancelAFinishedRunChangesNothing(t *testing.T) {
	h := newCancelHarness(t)
	id := h.start(t, &types.WorkflowDefinition{
		ID:    "wf-quick",
		Name:  "quick",
		Tasks: []types.TaskDefinition{{ID: "only", Type: "action", Action: "mark"}},
	})
	if status := h.log.awaitSettled(t, id); status != types.ExecutionStatusCompleted {
		t.Fatalf("settled %q, want completed", status)
	}

	result, err := h.engine.Cancel(id, "")
	if err != nil {
		t.Fatalf("Cancel: %v", err)
	}
	if result.Outcome != CancelOutcomeAlreadyFinished || result.Status != types.ExecutionStatusCompleted {
		t.Fatalf("Cancel = %+v, want already_finished/completed", result)
	}
	if got := h.log.settlements(id); len(got) != 1 {
		t.Errorf("settlements = %v, want exactly one", got)
	}
}

func TestCancelIsIdempotent(t *testing.T) {
	h := newCancelHarness(t)
	id := h.start(t, blockThenMark())
	h.awaitEntered(t)

	for i := 0; i < 3; i++ {
		result, err := h.engine.Cancel(id, "again")
		if err != nil {
			t.Fatalf("Cancel #%d: %v", i, err)
		}
		if result.Outcome != CancelOutcomeCancelled {
			t.Fatalf("Cancel #%d = %+v, want cancelled", i, result)
		}
	}
	h.log.awaitSettled(t, id)

	result, err := h.engine.Cancel(id, "after settling")
	if err != nil || result.Outcome != CancelOutcomeCancelled {
		t.Fatalf("Cancel after settling = %+v, %v; want cancelled", result, err)
	}
	if got := h.log.settlements(id); len(got) != 1 {
		t.Errorf("settlements = %v, want exactly one", got)
	}
}

func TestCancelAnUnknownRun(t *testing.T) {
	h := newCancelHarness(t)
	_, err := h.engine.Cancel("no-such-run", "")
	if !errors.Is(err, ErrExecutionNotFound) {
		t.Fatalf("Cancel error = %v, want ErrExecutionNotFound", err)
	}
}

func TestCancelDuringAConcurrentRun(t *testing.T) {
	h := newCancelHarness(t)
	id := h.start(t, &types.WorkflowDefinition{
		ID:   "wf-pair",
		Name: "pair",
		Tasks: []types.TaskDefinition{
			{ID: "left", Type: "action", Action: "block"},
			{ID: "right", Type: "action", Action: "block"},
			{ID: "after", Type: "action", Action: "mark", DependsOn: []string{"left", "right"}},
		},
	})
	h.awaitEntered(t)
	h.awaitEntered(t)

	if _, err := h.engine.Cancel(id, ""); err != nil {
		t.Fatalf("Cancel: %v", err)
	}
	if status := h.log.awaitSettled(t, id); status != types.ExecutionStatusCancelled {
		t.Fatalf("settled %q, want cancelled", status)
	}
	for _, taskID := range []string{"left", "right"} {
		if step, ok := h.log.step(taskID); !ok || step.Status != string(types.TaskStatusCancelled) {
			t.Errorf("%s step = %+v (recorded %v), want cancelled", taskID, step, ok)
		}
	}
	if h.didMark("after") {
		t.Error("the task after the cancelled run ran")
	}
}

func TestCancelClaimsAParentWaitingOnASubWorkflow(t *testing.T) {
	h := newCancelHarness(t)
	child := &types.WorkflowDefinition{
		ID:    "wf-child",
		Name:  "child",
		Tasks: []types.TaskDefinition{{ID: "child-slow", Type: "action", Action: "block"}},
	}
	if err := h.engine.RegisterWorkflow(child); err != nil {
		t.Fatalf("RegisterWorkflow: %v", err)
	}
	id := h.start(t, &types.WorkflowDefinition{
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

	if _, err := h.engine.Cancel(id, ""); err != nil {
		t.Fatalf("Cancel: %v", err)
	}
	if got := h.log.settlements(id); len(got) != 1 || got[0] != types.ExecutionStatusCancelled {
		t.Fatalf("parent settlements = %v, want [cancelled]", got)
	}

	var childID string
	h.engine.executionsMu.RLock()
	for execID, execution := range h.engine.executions {
		if execution.WorkflowID == "wf-child" {
			childID = execID
		}
	}
	h.engine.executionsMu.RUnlock()
	if status := h.log.awaitSettled(t, childID); status != types.ExecutionStatusCancelled {
		t.Fatalf("child settled %q, want cancelled", status)
	}
	if h.didMark("after") {
		t.Error("the parent continued after being cancelled")
	}
}

// A cancel racing a run to its end must settle the run exactly once, whichever
// wins. Meant to be run with -race.
func TestCancelRacingCompletionSettlesOnce(t *testing.T) {
	for i := 0; i < 50; i++ {
		e := newExecEngine(t)
		log := newRunLog()
		e.SetRunRecorder(log)
		e.SetPublisher(log)
		if err := e.RegisterAction("mark", func(ctx tasks.ActionContext[execSvcs], params map[string]any) (map[string]any, error) {
			return map[string]any{"ok": true}, nil
		}); err != nil {
			t.Fatalf("RegisterAction: %v", err)
		}
		wf := &types.WorkflowDefinition{
			ID:   "wf-race",
			Name: "race",
			Tasks: []types.TaskDefinition{
				{ID: "a", Type: "action", Action: "mark"},
				{ID: "b", Type: "action", Action: "mark", DependsOn: []string{"a"}},
			},
		}
		if err := e.RegisterWorkflow(wf); err != nil {
			t.Fatalf("RegisterWorkflow: %v", err)
		}
		result, err := e.RunManual(ManualRun{WorkflowID: wf.ID, Request: &types.Event{ID: "r", Type: "workflow.execute", Time: time.Now()}})
		if err != nil {
			t.Fatalf("RunManual: %v", err)
		}
		cancelResult, err := e.Cancel(result.ExecutionID, "race")
		if err != nil {
			t.Fatalf("Cancel: %v", err)
		}
		settled := log.awaitSettled(t, result.ExecutionID)
		time.Sleep(time.Millisecond)
		if got := log.settlements(result.ExecutionID); len(got) != 1 {
			t.Fatalf("iteration %d: settlements = %v, want exactly one", i, got)
		}
		// The answer Cancel gave is the outcome the run records.
		if cancelResult.Status != settled {
			t.Fatalf("iteration %d: Cancel said %q, run settled %q", i, cancelResult.Status, settled)
		}
	}
}

func waitUntil(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatal("condition never held")
		}
		time.Sleep(time.Millisecond)
	}
}

func containsString(list []string, want string) bool {
	for _, got := range list {
		if got == want {
			return true
		}
	}
	return false
}

func armedWaitsOf[T any](e *Engine[T]) int {
	e.waitingMu.RLock()
	defer e.waitingMu.RUnlock()
	return len(e.armedWaits)
}

// A delay has no event to arrive, only a timer. Cancel claims it like any
// other armed wait and stops the timer, rather than letting the run sit out
// the delay before it notices the cancel.
func TestCancelDuringADelay(t *testing.T) {
	h := newCancelHarness(t)
	id := h.start(t, &types.WorkflowDefinition{
		ID:   "wf-delay",
		Name: "delay",
		Tasks: []types.TaskDefinition{
			{ID: "pause", Type: "wait", Wait: &types.WaitConfig{Type: tasks.WaitTypeDelay, DurationMs: int64(time.Hour / time.Millisecond)}},
			{ID: "after", Type: "action", Action: "mark", DependsOn: []string{"pause"}},
		},
	})
	waitUntil(t, func() bool { return armedWaitsOf(h.engine) == 1 })

	if _, err := h.engine.Cancel(id, "changed my mind"); err != nil {
		t.Fatalf("Cancel: %v", err)
	}

	if got := h.log.settlements(id); len(got) != 1 || got[0] != types.ExecutionStatusCancelled {
		t.Fatalf("settlements = %v, want [cancelled]", got)
	}
	if n := armedWaitsOf(h.engine); n != 0 {
		t.Errorf("%d waits still armed after cancel, want 0", n)
	}
	step, ok := h.log.step("pause")
	if !ok || step.Status != string(types.TaskStatusCancelled) {
		t.Errorf("pause step = %+v (recorded %v), want cancelled", step, ok)
	}
	if h.didMark("after") {
		t.Error("a cancelled delay resumed its run")
	}
}

// A timed event wait is claimed from both places that could resume it: the
// event index and its timer.
func TestCancelClaimsATimedWaitAndItsTimer(t *testing.T) {
	h := newCancelHarness(t)
	// Stored without registration validation, which refuses the sub-second
	// timeout that keeps this test fast.
	id := h.startUnvalidated(t, &types.WorkflowDefinition{
		ID:   "wf-timed",
		Name: "timed",
		Tasks: []types.TaskDefinition{
			{ID: "hold", Type: "wait", Wait: &types.WaitConfig{
				Type:      tasks.WaitTypeEvent,
				Event:     "test.never",
				Timeout:   &types.Duration{Duration: 50 * time.Millisecond},
				OnTimeout: tasks.OnTimeoutContinue,
			}},
			{ID: "after", Type: "action", Action: "mark", DependsOn: []string{"hold"}},
		},
	})
	waitUntil(t, func() bool { return armedWaitsOf(h.engine) == 1 })

	if _, err := h.engine.Cancel(id, "stop"); err != nil {
		t.Fatalf("Cancel: %v", err)
	}
	if h.waitCount("test.never") != 0 || armedWaitsOf(h.engine) != 0 {
		t.Fatal("the cancelled wait is still armed")
	}

	// Past the timeout: a timer left running would resume the run and
	// continue to `after`.
	time.Sleep(150 * time.Millisecond)
	if h.didMark("after") {
		t.Error("the cancelled wait's timer resumed its run")
	}
	if got := h.log.settlements(id); len(got) != 1 || got[0] != types.ExecutionStatusCancelled {
		t.Errorf("settlements = %v, want exactly [cancelled]", got)
	}
}

// A wait reached by a run already cancelled is refused rather than armed:
// Cancel has claimed everything it will claim, so an armed wait would pause
// the run with nothing left to settle it.
func TestArmingRefusesACancelledRun(t *testing.T) {
	h := newCancelHarness(t)
	def := &types.WorkflowDefinition{ID: "wf-late-wait", Name: "late wait"}
	execution := h.engine.beginExecution(def, &types.Event{ID: "e", Type: "test.start", Time: time.Now()})
	if _, err := h.engine.Cancel(execution.ID, "early"); err != nil {
		t.Fatalf("Cancel: %v", err)
	}

	w := &WaitingExecution{
		ExecutionID: execution.ID,
		WorkflowID:  def.ID,
		TaskID:      "pause",
		TaskDef:     &types.TaskDefinition{ID: "pause", Type: "wait", Wait: &types.WaitConfig{Type: tasks.WaitTypeDelay, DurationMs: 1000}},
	}
	h.engine.waitingMu.Lock()
	refused := h.engine.armWaitLocked(w, time.Now().Add(time.Hour))
	h.engine.waitingMu.Unlock()

	if refused != "cancelled" {
		t.Errorf("armWaitLocked = %q, want cancelled", refused)
	}
	if n := armedWaitsOf(h.engine); n != 0 {
		t.Errorf("%d waits armed for a cancelled run, want 0", n)
	}
}
