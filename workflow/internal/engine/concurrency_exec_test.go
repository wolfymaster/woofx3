package engine

import (
	"sync"
	"testing"
	"time"

	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

type quietLogger struct{}

func (quietLogger) Debug(string, ...any) {}
func (quietLogger) Info(string, ...any)  {}
func (quietLogger) Warn(string, ...any)  {}
func (quietLogger) Error(string, ...any) {}

type execSvcs struct{}

func newExecEngine(t *testing.T) *Engine[execSvcs] {
	t.Helper()
	return New[execSvcs](quietLogger{})
}

func runExecution(e *Engine[execSvcs], order []*types.TaskDefinition) *types.WorkflowExecution {
	execution := &types.WorkflowExecution{
		ID:         "exec-1",
		WorkflowID: "wf-1",
		Status:     types.ExecutionStatusRunning,
		Tasks:      make(map[string]*types.TaskExecution),
		StartedAt:  time.Now(),
	}
	event := &types.Event{ID: "e1", Type: "channel.follow", Source: "test", Time: time.Now(), Data: map[string]any{}}
	e.executeTasksFromIndex(execution, order, 0, make(map[string]map[string]any), event)
	return execution
}

// The behaviour the issue asks for, proven rather than inferred: two
// independent tasks must be inside the handler at the same time. A sequential
// engine deadlocks on this barrier and fails the test by timeout.
func TestIndependentTasksActuallyOverlap(t *testing.T) {
	e := newExecEngine(t)
	var entered sync.WaitGroup
	entered.Add(2)
	overlapped := make(chan struct{})
	var once sync.Once

	if err := e.RegisterAction("barrier", func(ctx tasks.ActionContext[execSvcs], params map[string]any) (map[string]any, error) {
		entered.Done()
		// Blocks until the sibling also arrives. Only reachable concurrently.
		entered.Wait()
		once.Do(func() { close(overlapped) })
		return map[string]any{"ok": true}, nil
	}); err != nil {
		t.Fatalf("RegisterAction: %v", err)
	}

	order := []*types.TaskDefinition{
		{ID: "a", Type: "action", Action: "barrier", DependsOn: []string{"rule_1"}},
		{ID: "b", Type: "action", Action: "barrier", DependsOn: []string{"rule_1"}},
	}

	done := make(chan *types.WorkflowExecution, 1)
	go func() { done <- runExecution(e, order) }()

	select {
	case <-overlapped:
	case <-time.After(5 * time.Second):
		t.Fatal("independent tasks never overlapped — they ran sequentially")
	}

	select {
	case execution := <-done:
		if execution.Status != types.ExecutionStatusCompleted {
			t.Errorf("status = %v, want completed (error: %q)", execution.Status, execution.Error)
		}
		for _, id := range []string{"a", "b"} {
			if got := execution.Tasks[id].Status; got != types.TaskStatusSuccess {
				t.Errorf("task %s status = %v, want success", id, got)
			}
		}
	case <-time.After(5 * time.Second):
		t.Fatal("execution did not finish")
	}
}

// A task reading a sibling's exports without declaring dependsOn must keep
// working: it is the ordering-dependent case the issue warns about, and it
// stays sequential rather than becoming a race.
func TestAnUndeclaredReferenceStillResolves(t *testing.T) {
	e := newExecEngine(t)
	var mu sync.Mutex
	var seen string

	if err := e.RegisterAction("producer", func(ctx tasks.ActionContext[execSvcs], params map[string]any) (map[string]any, error) {
		return map[string]any{"value": "from-a"}, nil
	}); err != nil {
		t.Fatalf("RegisterAction: %v", err)
	}
	if err := e.RegisterAction("consumer", func(ctx tasks.ActionContext[execSvcs], params map[string]any) (map[string]any, error) {
		mu.Lock()
		defer mu.Unlock()
		if v, ok := params["text"].(string); ok {
			seen = v
		}
		return nil, nil
	}); err != nil {
		t.Fatalf("RegisterAction: %v", err)
	}

	order := []*types.TaskDefinition{
		{ID: "a", Type: "action", Action: "producer"},
		{ID: "b", Type: "action", Action: "consumer", Parameters: map[string]any{"text": "${a.value}"}},
	}
	execution := runExecution(e, order)

	if execution.Status != types.ExecutionStatusCompleted {
		t.Fatalf("status = %v, want completed (error: %q)", execution.Status, execution.Error)
	}
	mu.Lock()
	defer mu.Unlock()
	if seen != "from-a" {
		t.Errorf("consumer saw %q, want %q — the undeclared reference must still resolve", seen, "from-a")
	}
}

// A failure inside a run fails the execution, as it does sequentially, and
// siblings already running are allowed to finish rather than being cancelled.
func TestAFailureInARunFailsTheExecutionAndLetsSiblingsFinish(t *testing.T) {
	e := newExecEngine(t)
	var finished sync.WaitGroup
	finished.Add(1)

	if err := e.RegisterAction("boom", func(ctx tasks.ActionContext[execSvcs], params map[string]any) (map[string]any, error) {
		return nil, errBoom{}
	}); err != nil {
		t.Fatalf("RegisterAction: %v", err)
	}
	if err := e.RegisterAction("slow", func(ctx tasks.ActionContext[execSvcs], params map[string]any) (map[string]any, error) {
		time.Sleep(50 * time.Millisecond)
		finished.Done()
		return map[string]any{"ok": true}, nil
	}); err != nil {
		t.Fatalf("RegisterAction: %v", err)
	}

	order := []*types.TaskDefinition{
		{ID: "a", Type: "action", Action: "boom"},
		{ID: "b", Type: "action", Action: "slow"},
	}
	execution := runExecution(e, order)

	finished.Wait() // the sibling was not cancelled

	if execution.Status != types.ExecutionStatusFailed {
		t.Errorf("status = %v, want failed", execution.Status)
	}
	if execution.Tasks["a"].Status != types.TaskStatusFailed {
		t.Errorf("task a status = %v, want failed", execution.Tasks["a"].Status)
	}
	if execution.Tasks["b"].Status != types.TaskStatusSuccess {
		t.Errorf("task b status = %v, want success — siblings finish rather than being torn down", execution.Tasks["b"].Status)
	}
}

type errBoom struct{}

func (errBoom) Error() string { return "boom" }

// Exercises the shared maps with a full run at the cap. Meaningful under
// `-race`: every task reads the resolver's view of taskExports and the
// execution while its siblings do the same.
func TestAFullRunIsRaceFree(t *testing.T) {
	e := newExecEngine(t)
	if err := e.RegisterAction("work", func(ctx tasks.ActionContext[execSvcs], params map[string]any) (map[string]any, error) {
		return map[string]any{"n": params["n"]}, nil
	}); err != nil {
		t.Fatalf("RegisterAction: %v", err)
	}

	// One more task than the cap, so the run is capped and the remainder
	// executes in the following pass.
	total := DefaultMaxConcurrentTasks + 1
	order := make([]*types.TaskDefinition, 0, total)
	for i := 0; i < total; i++ {
		order = append(order, &types.TaskDefinition{
			ID:         string(rune('a' + i)),
			Type:       "action",
			Action:     "work",
			DependsOn:  []string{"rule_1"},
			Parameters: map[string]any{"n": i, "from": "${trigger.type}"},
		})
	}

	execution := runExecution(e, order)
	if execution.Status != types.ExecutionStatusCompleted {
		t.Fatalf("status = %v, want completed (error: %q)", execution.Status, execution.Error)
	}
	if len(execution.Tasks) != total {
		t.Errorf("recorded %d tasks, want %d", len(execution.Tasks), total)
	}
	for _, task := range order {
		if got := execution.Tasks[task.ID].Status; got != types.TaskStatusSuccess {
			t.Errorf("task %s status = %v, want success", task.ID, got)
		}
	}
}
