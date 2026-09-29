package engine

import (
	"sync"
	"testing"
	"time"

	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// settleRecorder reports every run that reaches a terminal state, and keeps
// the steps each run settled.
type settleRecorder struct {
	mu      sync.Mutex
	settled chan *types.WorkflowExecution
	steps   map[string]RunStep
}

func newSettleRecorder() *settleRecorder {
	return &settleRecorder{
		settled: make(chan *types.WorkflowExecution, 64),
		steps:   make(map[string]RunStep),
	}
}

func (r *settleRecorder) RunStarted(*types.WorkflowExecution) {}

func (r *settleRecorder) RunSettled(execution *types.WorkflowExecution) {
	if execution.Status == types.ExecutionStatusCompleted || execution.Status == types.ExecutionStatusFailed {
		r.settled <- execution
	}
}

func (r *settleRecorder) StepSettled(_ *types.WorkflowExecution, step RunStep) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.steps[step.TaskID] = step
}

func (r *settleRecorder) step(id string) (RunStep, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	step, ok := r.steps[id]
	return step, ok
}

func (r *settleRecorder) awaitSettled(t *testing.T, within time.Duration) *types.WorkflowExecution {
	t.Helper()
	select {
	case execution := <-r.settled:
		return execution
	case <-time.After(within):
		t.Fatalf("run did not settle within %s", within)
		return nil
	}
}

func (r *settleRecorder) expectNoMoreSettles(t *testing.T, within time.Duration) {
	t.Helper()
	select {
	case execution := <-r.settled:
		t.Fatalf("run settled a second time, as %s", execution.Status)
	case <-time.After(within):
	}
}

type waitHarness struct {
	engine   *Engine[execSvcs]
	recorder *settleRecorder
	mu       sync.Mutex
	marks    map[string]int
}

func newWaitHarness(t *testing.T) *waitHarness {
	t.Helper()
	h := &waitHarness{
		engine:   newExecEngine(t),
		recorder: newSettleRecorder(),
		marks:    make(map[string]int),
	}
	h.engine.SetRunRecorder(h.recorder)
	if err := h.engine.RegisterAction("mark", func(_ tasks.ActionContext[execSvcs], params map[string]any) (map[string]any, error) {
		id, ok := params["id"].(string)
		if !ok {
			t.Errorf("mark called without an id: %v", params)
		}
		h.mu.Lock()
		h.marks[id]++
		h.mu.Unlock()
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

func (h *waitHarness) timesMarked(id string) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.marks[id]
}

func (h *waitHarness) armedWaitCount() int {
	h.engine.waitingMu.RLock()
	defer h.engine.waitingMu.RUnlock()
	return len(h.engine.armedWaits)
}

// fire starts a run of a wait followed by a `mark` step. It runs the
// definition directly rather than through RegisterWorkflow, whose validation
// refuses the sub-second timeouts these tests use to stay fast.
func (h *waitHarness) fire(t *testing.T, wait *types.WaitConfig) {
	t.Helper()
	def := &types.WorkflowDefinition{
		ID:      "wf-wait",
		Name:    "wait",
		Trigger: &types.TriggerConfig{Type: "event", Event: "channel.raid"},
		Tasks: []types.TaskDefinition{
			{ID: "pause", Type: "wait", Wait: wait},
			{ID: "after", Type: "action", Action: "mark", DependsOn: []string{"pause"}, Parameters: map[string]any{"id": "after"}},
		},
	}
	trigger := &types.Event{ID: "raid-1", Type: "channel.raid", Source: "test", Time: time.Now(), Data: map[string]any{}}
	go h.engine.executeWorkflow(def, trigger)
}

func (h *waitHarness) awaitArmed(t *testing.T) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for h.armedWaitCount() == 0 {
		if time.Now().After(deadline) {
			t.Fatal("wait was never armed")
		}
		time.Sleep(time.Millisecond)
	}
}

func eventWait(timeout time.Duration, onTimeout string) *types.WaitConfig {
	return &types.WaitConfig{
		Type:      tasks.WaitTypeEvent,
		Event:     "channel.follow",
		Timeout:   &types.Duration{Duration: timeout},
		OnTimeout: onTimeout,
	}
}

func TestWaitTimeoutFailsRunWithoutAnyEvent(t *testing.T) {
	h := newWaitHarness(t)
	h.fire(t, eventWait(20*time.Millisecond, tasks.OnTimeoutFail))

	execution := h.recorder.awaitSettled(t, 2*time.Second)
	if execution.Status != types.ExecutionStatusFailed {
		t.Fatalf("status = %s, want failed", execution.Status)
	}
	if execution.Error != "wait timeout" {
		t.Fatalf("error = %q, want wait timeout", execution.Error)
	}
	if h.timesMarked("after") != 0 {
		t.Fatal("the step after a failed wait ran")
	}
	if h.armedWaitCount() != 0 {
		t.Fatal("a timed-out wait stayed armed")
	}
}

// A wait with no onTimeout fails, as documented, rather than continuing.
func TestWaitTimeoutDefaultsToFail(t *testing.T) {
	h := newWaitHarness(t)
	h.fire(t, eventWait(20*time.Millisecond, ""))

	execution := h.recorder.awaitSettled(t, 2*time.Second)
	if execution.Status != types.ExecutionStatusFailed {
		t.Fatalf("status = %s, want failed", execution.Status)
	}
}

func TestWaitTimeoutContinuesRun(t *testing.T) {
	h := newWaitHarness(t)
	h.fire(t, eventWait(20*time.Millisecond, tasks.OnTimeoutContinue))

	execution := h.recorder.awaitSettled(t, 2*time.Second)
	if execution.Status != types.ExecutionStatusCompleted {
		t.Fatalf("status = %s, want completed", execution.Status)
	}
	if h.timesMarked("after") != 1 {
		t.Fatalf("after ran %d times, want 1", h.timesMarked("after"))
	}
	step, ok := h.recorder.step("pause")
	if !ok {
		t.Fatal("the wait step was not recorded")
	}
	if step.Outputs["timedOut"] != true || step.Outputs["satisfied"] != false {
		t.Fatalf("wait outputs = %v, want timedOut true and satisfied false", step.Outputs)
	}
}

func TestWaitEventCancelsTimer(t *testing.T) {
	h := newWaitHarness(t)
	h.fire(t, eventWait(150*time.Millisecond, tasks.OnTimeoutFail))
	h.awaitArmed(t)

	follow := &types.Event{ID: "follow-1", Type: "channel.follow", Source: "test", Time: time.Now(), Data: map[string]any{}}
	if err := h.engine.HandleEvent(follow); err != nil {
		t.Fatalf("HandleEvent: %v", err)
	}

	execution := h.recorder.awaitSettled(t, 2*time.Second)
	if execution.Status != types.ExecutionStatusCompleted {
		t.Fatalf("status = %s, want completed", execution.Status)
	}
	// Outlive the timeout: a timer that was not cancelled would settle the run
	// a second time, as failed.
	h.recorder.expectNoMoreSettles(t, 300*time.Millisecond)
	if h.timesMarked("after") != 1 {
		t.Fatalf("after ran %d times, want 1", h.timesMarked("after"))
	}
	step, _ := h.recorder.step("pause")
	if step.Outputs["satisfied"] != true || step.Outputs["timedOut"] != false {
		t.Fatalf("wait outputs = %v, want satisfied true and timedOut false", step.Outputs)
	}
}

// An event and the timeout landing together must resume the run once, whichever
// wins. Meaningful under -race as well as without it.
func TestWaitEventRacingTimeoutResumesOnce(t *testing.T) {
	for i := 0; i < 25; i++ {
		h := newWaitHarness(t)
		h.fire(t, eventWait(2*time.Millisecond, tasks.OnTimeoutContinue))

		follow := &types.Event{ID: "follow-1", Type: "channel.follow", Source: "test", Time: time.Now(), Data: map[string]any{}}
		time.Sleep(time.Duration(i%4) * time.Millisecond)
		if err := h.engine.HandleEvent(follow); err != nil {
			t.Fatalf("HandleEvent: %v", err)
		}

		execution := h.recorder.awaitSettled(t, 2*time.Second)
		if execution.Status != types.ExecutionStatusCompleted {
			t.Fatalf("iteration %d: status = %s, want completed", i, execution.Status)
		}
		h.recorder.expectNoMoreSettles(t, 10*time.Millisecond)
		if got := h.timesMarked("after"); got != 1 {
			t.Fatalf("iteration %d: after ran %d times, want 1", i, got)
		}
	}
}

func TestDelayResumesRunAfterDuration(t *testing.T) {
	h := newWaitHarness(t)
	started := time.Now()
	h.fire(t, &types.WaitConfig{Type: tasks.WaitTypeDelay, DurationMs: 40})

	execution := h.recorder.awaitSettled(t, 2*time.Second)
	if execution.Status != types.ExecutionStatusCompleted {
		t.Fatalf("status = %s, want completed", execution.Status)
	}
	if elapsed := time.Since(started); elapsed < 40*time.Millisecond {
		t.Fatalf("delay resumed after %s, before its 40ms", elapsed)
	}
	if h.timesMarked("after") != 1 {
		t.Fatalf("after ran %d times, want 1", h.timesMarked("after"))
	}
	step, _ := h.recorder.step("pause")
	if step.Outputs["satisfied"] != true {
		t.Fatalf("delay outputs = %v, want satisfied true", step.Outputs)
	}
}

// A delay is not an event wait: an event of any type must not end it early.
func TestDelayIgnoresEvents(t *testing.T) {
	h := newWaitHarness(t)
	h.fire(t, &types.WaitConfig{Type: tasks.WaitTypeDelay, DurationMs: 80})
	h.awaitArmed(t)

	if err := h.engine.HandleEvent(&types.Event{ID: "x", Type: "", Source: "test", Time: time.Now()}); err != nil {
		t.Fatalf("HandleEvent: %v", err)
	}
	time.Sleep(20 * time.Millisecond)
	if h.timesMarked("after") != 0 {
		t.Fatal("an event ended a delay early")
	}
	h.recorder.awaitSettled(t, 2*time.Second)
}

// Waits live only in memory, so Stop drops them rather than resuming a run it
// has no way to finish.
func TestStopDisarmsPendingWaits(t *testing.T) {
	h := newWaitHarness(t)
	h.fire(t, &types.WaitConfig{Type: tasks.WaitTypeDelay, DurationMs: 30})
	h.awaitArmed(t)

	if err := h.engine.Stop(); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	if h.armedWaitCount() != 0 {
		t.Fatal("Stop left a wait armed")
	}
	h.recorder.expectNoMoreSettles(t, 100*time.Millisecond)
	if h.timesMarked("after") != 0 {
		t.Fatal("a delay resumed its run after Stop")
	}
}

// A wait without a timeout lasts until its event arrives, as it did before
// timeouts were enforced: no timer is armed, and an event arriving whenever it
// does still resumes the run successfully.
func TestWaitWithoutTimeoutWaitsForEvent(t *testing.T) {
	h := newWaitHarness(t)
	h.fire(t, &types.WaitConfig{Type: tasks.WaitTypeEvent, Event: "channel.follow"})
	h.awaitArmed(t)

	h.engine.waitingMu.RLock()
	for w := range h.engine.armedWaits {
		if w.timer != nil {
			t.Error("a wait without a timeout armed a timer")
		}
	}
	h.engine.waitingMu.RUnlock()
	h.recorder.expectNoMoreSettles(t, 50*time.Millisecond)

	follow := &types.Event{ID: "follow-1", Type: "channel.follow", Source: "test", Time: time.Now(), Data: map[string]any{}}
	if err := h.engine.HandleEvent(follow); err != nil {
		t.Fatalf("HandleEvent: %v", err)
	}
	execution := h.recorder.awaitSettled(t, 2*time.Second)
	if execution.Status != types.ExecutionStatusCompleted {
		t.Fatalf("status = %s, want completed", execution.Status)
	}
	if h.timesMarked("after") != 1 {
		t.Fatalf("after ran %d times, want 1", h.timesMarked("after"))
	}
}

// A run reaching a wait after Stop fails instead of pausing with nothing left
// to settle it.
func TestWaitAfterStopFailsRun(t *testing.T) {
	h := newWaitHarness(t)
	if err := h.engine.Stop(); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	h.fire(t, &types.WaitConfig{Type: tasks.WaitTypeDelay, DurationMs: 60 * 60 * 1000})

	execution := h.recorder.awaitSettled(t, 2*time.Second)
	if execution.Status != types.ExecutionStatusFailed || execution.Error != "engine stopped" {
		t.Fatalf("run = %s (%q), want failed with engine stopped", execution.Status, execution.Error)
	}
	if h.armedWaitCount() != 0 {
		t.Fatal("a wait was armed after Stop")
	}
}

// One event the wait cannot process must not stop it hearing the next.
func TestWaitSurvivesUnprocessableEvent(t *testing.T) {
	h := newWaitHarness(t)
	h.fire(t, &types.WaitConfig{
		Type:        tasks.WaitTypeAggregation,
		Event:       "channel.cheer",
		Aggregation: &types.AggregationConfig{Strategy: "threshold", Field: "data.bits", Threshold: 100},
	})
	h.awaitArmed(t)

	bad := &types.Event{ID: "c1", Type: "channel.cheer", Source: "test", Time: time.Now(), Data: map[string]any{"bits": "lots"}}
	if err := h.engine.HandleEvent(bad); err != nil {
		t.Fatalf("HandleEvent: %v", err)
	}
	good := &types.Event{ID: "c2", Type: "channel.cheer", Source: "test", Time: time.Now(), Data: map[string]any{"bits": 500}}
	if err := h.engine.HandleEvent(good); err != nil {
		t.Fatalf("HandleEvent: %v", err)
	}
	execution := h.recorder.awaitSettled(t, 2*time.Second)
	if execution.Status != types.ExecutionStatusCompleted {
		t.Fatalf("status = %s, want completed", execution.Status)
	}
}

func TestRegisterRefusesInvalidWait(t *testing.T) {
	e := newExecEngine(t)
	def := &types.WorkflowDefinition{
		ID:      "wf-bad",
		Name:    "bad",
		Trigger: &types.TriggerConfig{Type: "event", Event: "channel.raid"},
		Tasks: []types.TaskDefinition{
			{ID: "pause", Type: "wait", Wait: &types.WaitConfig{Type: tasks.WaitTypeDelay, DurationMs: 0}},
		},
	}
	if err := e.RegisterWorkflow(def); err == nil {
		t.Fatal("registered a delay of 0ms")
	}
	if _, err := e.GetWorkflow(def.ID); err == nil {
		t.Fatal("a refused workflow was still registered")
	}
}
