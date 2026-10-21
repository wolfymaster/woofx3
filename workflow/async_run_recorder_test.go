package main

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	dbv1 "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/workflow/internal/engine"
	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// stalledRunStore is a db proxy that never answers: every call blocks until
// its context ends. entered receives one value per call that reached it.
type stalledRunStore struct {
	entered chan string
}

func newStalledRunStore() *stalledRunStore {
	return &stalledRunStore{entered: make(chan string, 64)}
}

func (s *stalledRunStore) stall(ctx context.Context, call string) error {
	s.entered <- call
	<-ctx.Done()
	return ctx.Err()
}

func (s *stalledRunStore) RecordWorkflowRun(ctx context.Context, _ *dbv1.RecordWorkflowRunRequest) (*dbv1.WorkflowExecutionResponse, error) {
	return nil, s.stall(ctx, "run")
}

func (s *stalledRunStore) UpdateWorkflowRunStatus(ctx context.Context, _ *dbv1.UpdateWorkflowRunStatusRequest) (*dbv1.WorkflowExecutionResponse, error) {
	return nil, s.stall(ctx, "outcome")
}

func (s *stalledRunStore) RecordWorkflowRunStep(ctx context.Context, _ *dbv1.RecordWorkflowRunStepRequest) (*dbv1.ResponseStatus, error) {
	return nil, s.stall(ctx, "step")
}

// sequenceRunStore records the order writes reached the db proxy in.
type sequenceRunStore struct {
	mu    sync.Mutex
	calls []string
}

func (s *sequenceRunStore) note(call string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls = append(s.calls, call)
}

func (s *sequenceRunStore) RecordWorkflowRun(_ context.Context, req *dbv1.RecordWorkflowRunRequest) (*dbv1.WorkflowExecutionResponse, error) {
	s.note("run " + req.Id)
	return &dbv1.WorkflowExecutionResponse{}, nil
}

func (s *sequenceRunStore) UpdateWorkflowRunStatus(_ context.Context, req *dbv1.UpdateWorkflowRunStatusRequest) (*dbv1.WorkflowExecutionResponse, error) {
	s.note("outcome " + req.Id)
	return &dbv1.WorkflowExecutionResponse{}, nil
}

func (s *sequenceRunStore) RecordWorkflowRunStep(_ context.Context, req *dbv1.RecordWorkflowRunStepRequest) (*dbv1.ResponseStatus, error) {
	s.note("step " + req.ExecutionId + "/" + req.TaskId)
	return &dbv1.ResponseStatus{}, nil
}

// warnLogger counts warnings; safe for the writer goroutine.
type warnLogger struct {
	mu    sync.Mutex
	warns []string
}

func (l *warnLogger) Info(string, ...any)  {}
func (l *warnLogger) Error(string, ...any) {}
func (l *warnLogger) Debug(string, ...any) {}
func (l *warnLogger) Warn(message string, _ ...any) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.warns = append(l.warns, message)
}

func (l *warnLogger) count(message string) int {
	l.mu.Lock()
	defer l.mu.Unlock()
	n := 0
	for _, w := range l.warns {
		if w == message {
			n++
		}
	}
	return n
}

// fakeClock is a settable clock for the drop warning's rate limit.
type fakeClock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *fakeClock) advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

func startedRecorder(t *testing.T, store runStore, cfg recorderConfig, logger tasks.Logger, now func() time.Time) *asyncRunRecorder {
	t.Helper()
	recorder, err := newAsyncRunRecorder(store, cfg, logger, now)
	if err != nil {
		t.Fatalf("newAsyncRunRecorder: %v", err)
	}
	recorder.Start()
	return recorder
}

func waitEntered(t *testing.T, store *stalledRunStore, want string) {
	t.Helper()
	select {
	case got := <-store.entered:
		if got != want {
			t.Fatalf("db proxy got %q first, want %q", got, want)
		}
	case <-time.After(5 * time.Second):
		t.Fatalf("db proxy never received %q", want)
	}
}

// An ordered workflow begins its run on the goroutine that delivered the
// event, which for a bus subscription is the subscription itself. A db proxy
// that never answers must not hold that goroutine, and must not hold shutdown
// past its drain budget either.
func TestAsyncRecorderKeepsAStalledDbOffTheDeliveryPath(t *testing.T) {
	store := newStalledRunStore()
	recorder := startedRecorder(t, store, defaultRecorderConfig(), quietLogger{}, time.Now)

	e := engine.New[AppServices](quietLogger{})
	e.SetRunRecorder(recorder)
	ran := make(chan struct{}, 1)
	if err := e.RegisterAction("note", func(tasks.ActionContext[AppServices], map[string]any) (map[string]any, error) {
		ran <- struct{}{}
		return map[string]any{}, nil
	}); err != nil {
		t.Fatalf("RegisterAction: %v", err)
	}
	order := 0
	if err := e.RegisterWorkflow(&types.WorkflowDefinition{
		ID:      "ordered",
		Name:    "ordered",
		Trigger: &types.TriggerConfig{Type: "event", Event: "channel.cheer", Order: &order},
		Tasks:   []types.TaskDefinition{{ID: "step", Type: "action", Action: "note"}},
	}); err != nil {
		t.Fatalf("RegisterWorkflow: %v", err)
	}

	handled := make(chan error, 1)
	go func() {
		handled <- e.HandleEvent(&types.Event{ID: "e1", Type: "channel.cheer", Source: "twitch", Time: time.Now(), Data: map[string]any{}})
	}()
	select {
	case err := <-handled:
		if err != nil {
			t.Fatalf("HandleEvent: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("HandleEvent blocked on a db proxy that never answers")
	}

	select {
	case <-ran:
	case <-time.After(5 * time.Second):
		t.Fatal("the ordered run never reached its step")
	}
	waitEntered(t, store, "run")

	if err := e.Stop(); err != nil {
		t.Fatalf("engine Stop: %v", err)
	}
	const drainBudget = 100 * time.Millisecond
	ctx, cancel := context.WithTimeout(context.Background(), drainBudget)
	defer cancel()
	began := time.Now()
	err := recorder.Stop(ctx)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Stop = %v, want the drain cut short", err)
	}
	if took := time.Since(began); took > drainBudget+time.Second {
		t.Fatalf("Stop took %s, budget %s", took, drainBudget)
	}
	if recorder.Dropped() == 0 {
		t.Fatal("writes left behind at shutdown were not counted")
	}
}

// One writer, first in first out: a run's row reaches the db proxy before its
// steps and its outcome, which reference it.
func TestAsyncRecorderWritesARunBeforeItsSteps(t *testing.T) {
	store := &sequenceRunStore{}
	recorder := startedRecorder(t, store, defaultRecorderConfig(), quietLogger{}, time.Now)

	for _, id := range []string{"exec-1", "exec-2"} {
		execution := runWith("twitch")
		execution.ID = id
		recorder.RunStarted(execution)
		recorder.StepSettled(execution, engine.RunStep{TaskID: "a"})
		recorder.StepSettled(execution, engine.RunStep{TaskID: "b"})
		execution.Status = types.ExecutionStatusCompleted
		recorder.RunSettled(execution)
	}
	drain(t, recorder)

	want := []string{
		"run exec-1", "step exec-1/a", "step exec-1/b", "outcome exec-1",
		"run exec-2", "step exec-2/a", "step exec-2/b", "outcome exec-2",
	}
	if len(store.calls) != len(want) {
		t.Fatalf("writes = %v, want %v", store.calls, want)
	}
	for i := range want {
		if store.calls[i] != want[i] {
			t.Fatalf("writes = %v, want %v", store.calls, want)
		}
	}
}

// The request is captured when the engine reports the change, not when the
// writer reaches it, so a run that moves on in the meantime is recorded as it
// was reported.
func TestAsyncRecorderCapturesTheRunAsReported(t *testing.T) {
	recorder, store := recorderFixture(t)
	execution := runWith("twitch")
	execution.Status = types.ExecutionStatusFailed

	recorder.RunSettled(execution)
	execution.Status = types.ExecutionStatusCompleted
	drain(t, recorder)

	if len(store.updates) != 1 || store.updates[0].Status != string(types.ExecutionStatusFailed) {
		t.Fatalf("outcome not captured as reported: %+v", store.updates)
	}
}

func TestAsyncRecorderDropsAndCountsWhenFull(t *testing.T) {
	const dropped = "workflow run history dropped"
	store := newStalledRunStore()
	logger := &warnLogger{}
	clock := &fakeClock{now: time.Unix(1_700_000_000, 0)}
	cfg := defaultRecorderConfig()
	cfg.QueueSize = 1
	recorder := startedRecorder(t, store, cfg, logger, clock.Now)

	// The writer takes the first write and stalls on it; the second fills the
	// queue; everything after that has nowhere to go.
	recorder.RunStarted(runWith("twitch"))
	waitEntered(t, store, "run")
	recorder.StepSettled(runWith("twitch"), engine.RunStep{TaskID: "queued"})
	recorder.StepSettled(runWith("twitch"), engine.RunStep{TaskID: "over-1"})
	recorder.StepSettled(runWith("twitch"), engine.RunStep{TaskID: "over-2"})

	if got := recorder.Dropped(); got != 2 {
		t.Fatalf("Dropped = %d, want 2", got)
	}
	if got := logger.count(dropped); got != 1 {
		t.Fatalf("drop warnings = %d within one interval, want 1", got)
	}

	clock.advance(cfg.DropLogInterval)
	recorder.StepSettled(runWith("twitch"), engine.RunStep{TaskID: "over-3"})
	if got := logger.count(dropped); got != 2 {
		t.Fatalf("drop warnings = %d after the interval, want 2", got)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if err := recorder.Stop(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Stop = %v, want the drain cut short", err)
	}
}

// A write that outlives the call timeout is abandoned and the writer moves on
// to the next, rather than waiting on the db proxy for as long as it takes.
func TestAsyncRecorderBoundsEachWrite(t *testing.T) {
	store := newStalledRunStore()
	cfg := defaultRecorderConfig()
	cfg.CallTimeout = 20 * time.Millisecond
	recorder := startedRecorder(t, store, cfg, quietLogger{}, time.Now)

	recorder.RunStarted(runWith("twitch"))
	recorder.StepSettled(runWith("twitch"), engine.RunStep{TaskID: "next"})
	waitEntered(t, store, "run")
	waitEntered(t, store, "step")
	drain(t, recorder)
}

func TestAsyncRecorderLifecycle(t *testing.T) {
	recorder, err := newAsyncRunRecorder(&stubRunStore{}, defaultRecorderConfig(), quietLogger{}, time.Now)
	if err != nil {
		t.Fatalf("newAsyncRunRecorder: %v", err)
	}
	if err := recorder.Stop(context.Background()); !errors.Is(err, errRecorderNotStarted) {
		t.Fatalf("Stop before Start = %v, want errRecorderNotStarted", err)
	}
	recorder.Start()
	drain(t, recorder)
	if err := recorder.Stop(context.Background()); !errors.Is(err, errRecorderStopped) {
		t.Fatalf("second Stop = %v, want errRecorderStopped", err)
	}

	recorder.RunStarted(runWith("twitch"))
	if got := recorder.Dropped(); got != 1 {
		t.Fatalf("a write after Stop was not counted as dropped: Dropped = %d", got)
	}
}

func TestAsyncRecorderRefusesInvalidConfig(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*recorderConfig)
	}{
		{name: "empty queue", mutate: func(c *recorderConfig) { c.QueueSize = 0 }},
		{name: "no call timeout", mutate: func(c *recorderConfig) { c.CallTimeout = 0 }},
		{name: "no drain timeout", mutate: func(c *recorderConfig) { c.DrainTimeout = 0 }},
		{name: "no drop log interval", mutate: func(c *recorderConfig) { c.DropLogInterval = -time.Second }},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			cfg := defaultRecorderConfig()
			tc.mutate(&cfg)
			if _, err := newAsyncRunRecorder(&stubRunStore{}, cfg, quietLogger{}, time.Now); err == nil {
				t.Fatal("invalid config accepted")
			}
		})
	}
	if _, err := newAsyncRunRecorder(nil, defaultRecorderConfig(), quietLogger{}, time.Now); err == nil {
		t.Fatal("a recorder without a store was accepted")
	}
}

func TestDBHTTPClientHasATimeout(t *testing.T) {
	cfg := &WorkflowEnvConfig{}
	timeout, err := cfg.dbRequestTimeout()
	if err != nil {
		t.Fatalf("dbRequestTimeout: %v", err)
	}
	if got := newDBHTTPClient(timeout).Timeout; got != DefaultDbRequestTimeout {
		t.Fatalf("db client timeout = %s, want %s", got, DefaultDbRequestTimeout)
	}
}
