package engine

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// executions is every run the table holds, keyed by id, for tests that look
// a run up by its workflow.
func (t *runTable) executions() map[string]*types.WorkflowExecution {
	t.mu.RLock()
	defer t.mu.RUnlock()
	held := make(map[string]*types.WorkflowExecution, len(t.runs))
	for id, entry := range t.runs {
		held[id] = entry.execution
	}
	return held
}

// invariantViolation reports an entry missing half of its run, filed under
// another run's id, or carrying a settle stamp its control never claimed.
func (t *runTable) invariantViolation() error {
	t.mu.RLock()
	defer t.mu.RUnlock()
	for id, entry := range t.runs {
		if entry.execution == nil || entry.control == nil {
			return fmt.Errorf("run %s is missing its execution or control", id)
		}
		if entry.execution.ID != id {
			return fmt.Errorf("run %s is filed under %s", entry.execution.ID, id)
		}
		if !entry.settledAt.IsZero() && !entry.control.isSettled() {
			return fmt.Errorf("run %s has a settle stamp but no claimed outcome", id)
		}
	}
	return nil
}

type fakeClock struct {
	mu  sync.Mutex
	now time.Time
}

func newFakeClock() *fakeClock {
	return &fakeClock{now: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

// settledTableRun adds a run to the table and settles it at `at`.
func settledTableRun(table *runTable, id string, at time.Time) {
	ctl := &runControl{ctx: context.Background(), cancel: func() {}}
	table.put(&types.WorkflowExecution{ID: id}, ctl)
	ctl.claimSettle(types.ExecutionStatusCompleted, nil)
	table.settle(id, at)
}

func noPins(string) bool { return false }

func TestRunTableSweep(t *testing.T) {
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	retention := RetentionConfig{RetentionTTL: time.Minute, SweepInterval: time.Second, MaxSettledRuns: 3}
	tests := []struct {
		name    string
		settled map[string]time.Duration // id -> settled this long after base
		running []string
		pinned  map[string]bool
		now     time.Duration
		want    []string
	}{
		{
			name:    "runs settled a TTL ago are evicted",
			settled: map[string]time.Duration{"old": 0, "edge": time.Second, "fresh": 50 * time.Second},
			now:     61 * time.Second,
			want:    []string{"fresh"},
		},
		{
			name:    "unsettled runs are never evicted",
			running: []string{"running"},
			now:     time.Hour,
			want:    []string{"running"},
		},
		{
			name:    "a pinned run outlives its TTL",
			settled: map[string]time.Duration{"child": 0, "other": 0},
			pinned:  map[string]bool{"child": true},
			now:     time.Hour,
			want:    []string{"child"},
		},
		{
			name: "over the cap the oldest settled go first",
			settled: map[string]time.Duration{
				"s1": 1 * time.Second, "s2": 2 * time.Second, "s3": 3 * time.Second,
				"s4": 4 * time.Second, "s5": 5 * time.Second,
			},
			running: []string{"running"},
			now:     10 * time.Second,
			want:    []string{"running", "s3", "s4", "s5"},
		},
		{
			name: "pinned runs count toward the cap but are not evicted for it",
			settled: map[string]time.Duration{
				"p1": 1 * time.Second, "s2": 2 * time.Second, "s3": 3 * time.Second, "s4": 4 * time.Second,
			},
			pinned: map[string]bool{"p1": true},
			now:    10 * time.Second,
			want:   []string{"p1", "s3", "s4"},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			table := newRunTable()
			for id, after := range tc.settled {
				settledTableRun(table, id, base.Add(after))
			}
			for _, id := range tc.running {
				table.put(&types.WorkflowExecution{ID: id}, &runControl{ctx: context.Background(), cancel: func() {}})
			}
			pinned := func(id string) bool { return tc.pinned[id] }

			table.sweep(base.Add(tc.now), retention, pinned)

			if err := table.invariantViolation(); err != nil {
				t.Fatal(err)
			}
			held := table.executions()
			if len(held) != len(tc.want) {
				t.Fatalf("table holds %v, want %v", keys(held), tc.want)
			}
			for _, id := range tc.want {
				if _, ok := held[id]; !ok {
					t.Fatalf("table holds %v, want %v", keys(held), tc.want)
				}
			}
		})
	}
}

func TestRunTableSettleKeepsTheFirstStamp(t *testing.T) {
	table := newRunTable()
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	settledTableRun(table, "run", base)
	table.settle("run", base.Add(time.Hour))

	table.sweep(base.Add(time.Minute), RetentionConfig{RetentionTTL: time.Minute, SweepInterval: time.Second, MaxSettledRuns: 10}, noPins)

	if _, _, ok := table.get("run"); ok {
		t.Fatal("a second settle extended the run's retention")
	}
}

func TestRunTableEvictionCancelsTheRunContext(t *testing.T) {
	table := newRunTable()
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	ctl := newRunControl("run", &runViewer{})
	table.put(&types.WorkflowExecution{ID: "run"}, ctl)
	ctl.claimSettle(types.ExecutionStatusCompleted, nil)
	table.settle("run", base)

	table.sweep(base.Add(time.Hour), DefaultRetentionConfig(), noPins)

	if ctl.ctx.Err() == nil {
		t.Fatal("an evicted run's context was left open")
	}
}

func TestRunTablePutRefusesADuplicate(t *testing.T) {
	table := newRunTable()
	table.put(&types.WorkflowExecution{ID: "run"}, &runControl{})
	defer func() {
		if recover() == nil {
			t.Fatal("a second run under the same id was accepted")
		}
	}()
	table.put(&types.WorkflowExecution{ID: "run"}, &runControl{})
}

func TestRetentionConfigValidate(t *testing.T) {
	tests := []struct {
		name    string
		mutate  func(*RetentionConfig)
		wantErr bool
	}{
		{name: "defaults are valid", mutate: func(*RetentionConfig) {}},
		{name: "zero TTL is refused", mutate: func(c *RetentionConfig) { c.RetentionTTL = 0 }, wantErr: true},
		{name: "zero sweep interval is refused", mutate: func(c *RetentionConfig) { c.SweepInterval = 0 }, wantErr: true},
		{name: "zero cap is refused", mutate: func(c *RetentionConfig) { c.MaxSettledRuns = 0 }, wantErr: true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			cfg := DefaultRetentionConfig()
			tc.mutate(&cfg)
			err := cfg.Validate()
			if (err != nil) != tc.wantErr {
				t.Fatalf("Validate() = %v, wantErr %v", err, tc.wantErr)
			}
		})
	}
}

// settleWatch is a recorder that counts settled runs and can act inside the
// settle, at the point the run's outcome is decided but before anything
// waiting on the run has been released.
type settleWatch struct {
	mu       sync.Mutex
	settled  map[string]types.ExecutionStatus
	onSettle func(execution *types.WorkflowExecution)
}

func newSettleWatch() *settleWatch {
	return &settleWatch{settled: make(map[string]types.ExecutionStatus)}
}

func (w *settleWatch) RunStarted(*types.WorkflowExecution)           {}
func (w *settleWatch) StepSettled(*types.WorkflowExecution, RunStep) {}

func (w *settleWatch) RunSettled(execution *types.WorkflowExecution) {
	w.mu.Lock()
	w.settled[execution.ID] = execution.Status
	onSettle := w.onSettle
	w.mu.Unlock()
	if onSettle != nil {
		onSettle(execution)
	}
}

func (w *settleWatch) count() int {
	w.mu.Lock()
	defer w.mu.Unlock()
	return len(w.settled)
}

func (w *settleWatch) status(executionID string) (types.ExecutionStatus, bool) {
	w.mu.Lock()
	defer w.mu.Unlock()
	status, ok := w.settled[executionID]
	return status, ok
}

// newRetentionEngine is an engine on a fake clock with a `mark` action and
// one workflow per event type in eventTypes.
func newRetentionEngine(t *testing.T, eventTypes ...string) (*Engine[execSvcs], *fakeClock, *settleWatch) {
	t.Helper()
	e := newExecEngine(t)
	clock := newFakeClock()
	e.now = clock.Now
	watch := newSettleWatch()
	e.SetRunRecorder(watch)
	if err := e.RegisterAction("mark", func(tasks.ActionContext[execSvcs], map[string]any) (map[string]any, error) {
		return map[string]any{"ok": true}, nil
	}); err != nil {
		t.Fatalf("RegisterAction: %v", err)
	}
	for _, eventType := range eventTypes {
		if err := e.RegisterWorkflow(&types.WorkflowDefinition{
			ID:      "wf-" + eventType,
			Name:    eventType,
			Trigger: &types.TriggerConfig{Type: "event", Event: eventType},
			Tasks:   []types.TaskDefinition{{ID: "mark", Type: "action", Action: "mark"}},
		}); err != nil {
			t.Fatalf("RegisterWorkflow: %v", err)
		}
	}
	t.Cleanup(func() {
		if err := e.Stop(); err != nil {
			t.Errorf("Stop: %v", err)
		}
	})
	return e, clock, watch
}

func fireEvent(t *testing.T, e *Engine[execSvcs], eventType string, n int) {
	t.Helper()
	event := &types.Event{ID: fmt.Sprintf("%s-%d", eventType, n), Type: eventType, Source: "test", Time: time.Now(), Data: map[string]any{}}
	if err := e.HandleEvent(event); err != nil {
		t.Errorf("HandleEvent: %v", err)
	}
}

func TestSettledRunsAreEvictedAfterTheirRetention(t *testing.T) {
	e, clock, watch := newRetentionEngine(t, "channel.follow")
	const runs = 20
	for i := 0; i < runs; i++ {
		fireEvent(t, e, "channel.follow", i)
	}
	waitUntil(t, func() bool { return watch.count() == runs })

	e.sweepSettledRuns()
	if held := len(e.runs.executions()); held != runs {
		t.Fatalf("sweep inside the retention left %d runs, want %d", held, runs)
	}

	clock.Advance(DefaultRunRetentionTTL)
	e.sweepSettledRuns()

	if held := e.runs.executions(); len(held) != 0 {
		t.Fatalf("engine still holds %d settled runs after their retention", len(held))
	}
}

func TestAParentResumesFromAChildThatSettledBeforeTheSweep(t *testing.T) {
	e, clock, watch := newRetentionEngine(t)
	release := make(chan struct{})
	if err := e.RegisterAction("gate", func(tasks.ActionContext[execSvcs], map[string]any) (map[string]any, error) {
		<-release
		return map[string]any{"ok": true}, nil
	}); err != nil {
		t.Fatalf("RegisterAction: %v", err)
	}
	if err := e.RegisterWorkflow(&types.WorkflowDefinition{
		ID:    "wf-child",
		Name:  "child",
		Tasks: []types.TaskDefinition{{ID: "gate", Type: "action", Action: "gate"}},
	}); err != nil {
		t.Fatalf("RegisterWorkflow child: %v", err)
	}
	if err := e.RegisterWorkflow(&types.WorkflowDefinition{
		ID:      "wf-parent",
		Name:    "parent",
		Trigger: &types.TriggerConfig{Type: "event", Event: "channel.raid"},
		Tasks: []types.TaskDefinition{
			{ID: "call", Type: "workflow", Workflow: &types.WorkflowConfig{WorkflowID: "wf-child", WaitUntilCompletion: true}},
			{ID: "after", Type: "action", Action: "mark", DependsOn: []string{"call"}},
		},
	}); err != nil {
		t.Fatalf("RegisterWorkflow parent: %v", err)
	}

	// The sweep runs inside the child's settle: its outcome is decided, its
	// retention has passed, and the parent has not been released yet.
	watch.onSettle = func(execution *types.WorkflowExecution) {
		if execution.WorkflowID == "wf-child" {
			clock.Advance(DefaultRunRetentionTTL)
			e.sweepSettledRuns()
		}
	}

	fireEvent(t, e, "channel.raid", 1)
	waitUntil(t, func() bool {
		e.subWorkflowWaitersMu.RLock()
		defer e.subWorkflowWaitersMu.RUnlock()
		return len(e.subWorkflowWaiters) == 1
	})
	var parentID string
	for id, execution := range e.runs.executions() {
		if execution.WorkflowID == "wf-parent" {
			parentID = id
		}
	}
	close(release)

	waitUntil(t, func() bool {
		_, settled := watch.status(parentID)
		return settled
	})
	if status, _ := watch.status(parentID); status != types.ExecutionStatusCompleted {
		t.Fatalf("parent settled %q, want completed", status)
	}

	watch.mu.Lock()
	watch.onSettle = nil
	watch.mu.Unlock()
	clock.Advance(DefaultRunRetentionTTL)
	e.sweepSettledRuns()
	if held := e.runs.executions(); len(held) != 0 {
		t.Fatalf("engine still holds %v once nothing waits on them", keys(held))
	}
}

func TestRunTableInvariantUnderConcurrentEvents(t *testing.T) {
	eventTypes := []string{"channel.follow", "channel.subscribe", "channel.cheer"}
	e, clock, watch := newRetentionEngine(t, eventTypes...)
	const perType = 40

	sweeping := make(chan struct{})
	sweeperDone := make(chan struct{})
	go func() {
		defer close(sweeperDone)
		for {
			select {
			case <-sweeping:
				return
			default:
			}
			clock.Advance(time.Second)
			e.sweepSettledRuns()
			if err := e.runs.invariantViolation(); err != nil {
				t.Error(err)
				return
			}
		}
	}()

	var fired sync.WaitGroup
	for _, eventType := range eventTypes {
		fired.Add(1)
		go func(eventType string) {
			defer fired.Done()
			for i := 0; i < perType; i++ {
				fireEvent(t, e, eventType, i)
			}
		}(eventType)
	}
	fired.Wait()
	waitUntil(t, func() bool { return watch.count() == perType*len(eventTypes) })
	close(sweeping)
	<-sweeperDone

	if err := e.runs.invariantViolation(); err != nil {
		t.Fatal(err)
	}
	clock.Advance(DefaultRunRetentionTTL)
	e.sweepSettledRuns()
	if held := e.runs.executions(); len(held) != 0 {
		t.Fatalf("engine still holds %d settled runs after their retention", len(held))
	}
}

func keys(held map[string]*types.WorkflowExecution) []string {
	ids := make([]string, 0, len(held))
	for id := range held {
		ids = append(ids, id)
	}
	return ids
}
