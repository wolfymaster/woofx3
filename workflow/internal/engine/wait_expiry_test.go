package engine

import (
	"testing"
	"time"

	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// A wait whose timeout is already in the past when it registers. The first pass
// through handleWaitTask registers the waiter without judging the deadline, so
// this is a run parked in exactly the state the sweeper exists to settle.
func waitTask(id string, onTimeout string, timeout time.Duration) *types.TaskDefinition {
	return &types.TaskDefinition{
		ID:   id,
		Type: "wait",
		Wait: &types.WaitConfig{
			Type:      "event",
			Event:     "channel.follow",
			Timeout:   &types.Duration{Duration: timeout},
			OnTimeout: onTimeout,
		},
	}
}

// Registers the execution the way a real run does, so the sweeper can find it.
func startWaiting(t *testing.T, e *Engine[execSvcs], order []*types.TaskDefinition) *types.WorkflowExecution {
	t.Helper()
	execution := &types.WorkflowExecution{
		ID:         "exec-1",
		WorkflowID: "wf-1",
		Status:     types.ExecutionStatusRunning,
		Tasks:      make(map[string]*types.TaskExecution),
		StartedAt:  time.Now(),
	}

	e.executionsMu.Lock()
	e.executions[execution.ID] = execution
	e.executionsMu.Unlock()

	event := &types.Event{ID: "e1", Type: "channel.cheer", Source: "test", Time: time.Now(), Data: map[string]any{}}
	e.executeTasksFromIndex(execution, order, 0, make(map[string]map[string]any), event)

	if execution.Status != types.ExecutionStatusWaiting {
		t.Fatalf("execution status = %v, want waiting", execution.Status)
	}
	return execution
}

func waitingCount(e *Engine[execSvcs]) int {
	e.waitingMu.RLock()
	defer e.waitingMu.RUnlock()
	total := 0
	for _, waiting := range e.waitingExecutions {
		total += len(waiting)
	}
	return total
}

// Nothing else settles this run: the wait is only reconsidered when a matching
// event arrives, and none ever does.
func TestAWaitPastItsTimeoutIsFailed(t *testing.T) {
	e := newExecEngine(t)
	execution := startWaiting(t, e, []*types.TaskDefinition{waitTask("hold", "fail", -time.Second)})

	e.expireTimedOutWaits(time.Now())

	if execution.Status != types.ExecutionStatusFailed {
		t.Errorf("execution status = %v, want failed", execution.Status)
	}
	if got := execution.Tasks["hold"]; got == nil || got.Status != types.TaskStatusFailed {
		t.Errorf("task status = %v, want failed", got)
	}
	if got := execution.Tasks["hold"].Error; got != "wait timeout" {
		t.Errorf("task error = %q, want %q", got, "wait timeout")
	}
	if waitingCount(e) != 0 {
		t.Errorf("%d waiters left after expiry, want 0", waitingCount(e))
	}
}

// `continue` is the whole reason the setting exists, and it was unreachable for
// a wait nothing ever satisfied.
func TestAWaitPastItsTimeoutCanContinue(t *testing.T) {
	e := newExecEngine(t)

	ran := make(chan struct{}, 1)
	if err := e.RegisterAction("after-wait", func(tasks.ActionContext[execSvcs], map[string]any) (map[string]any, error) {
		ran <- struct{}{}
		return map[string]any{"ok": true}, nil
	}); err != nil {
		t.Fatalf("RegisterAction: %v", err)
	}

	execution := startWaiting(t, e, []*types.TaskDefinition{
		waitTask("hold", "continue", -time.Second),
		{ID: "next", Type: "action", Action: "after-wait"},
	})

	e.expireTimedOutWaits(time.Now())

	select {
	case <-ran:
	case <-time.After(2 * time.Second):
		t.Fatal("the task after the wait never ran")
	}

	if got := execution.Tasks["hold"]; got == nil || got.Status != types.TaskStatusSuccess {
		t.Errorf("timed-out wait status = %v, want success for onTimeout=continue", got)
	}
	if waitingCount(e) != 0 {
		t.Errorf("%d waiters left after expiry, want 0", waitingCount(e))
	}
}

// The default when a wait names no onTimeout.
func TestAWaitWithNoOnTimeoutFails(t *testing.T) {
	e := newExecEngine(t)
	execution := startWaiting(t, e, []*types.TaskDefinition{waitTask("hold", "", -time.Second)})

	e.expireTimedOutWaits(time.Now())

	if execution.Status != types.ExecutionStatusFailed {
		t.Errorf("execution status = %v, want failed", execution.Status)
	}
}

func TestAWaitInsideItsTimeoutIsLeftWaiting(t *testing.T) {
	e := newExecEngine(t)
	execution := startWaiting(t, e, []*types.TaskDefinition{waitTask("hold", "fail", time.Hour)})

	e.expireTimedOutWaits(time.Now())

	if execution.Status != types.ExecutionStatusWaiting {
		t.Errorf("execution status = %v, want it still waiting", execution.Status)
	}
	if waitingCount(e) != 1 {
		t.Errorf("%d waiters, want the one still inside its timeout", waitingCount(e))
	}
}

// Waiters whose run has gone are what made the map grow for the process's
// lifetime: nothing removed them, because only a matching event ever looked.
func TestExpiryDropsWaitersWhoseRunIsGone(t *testing.T) {
	e := newExecEngine(t)
	startWaiting(t, e, []*types.TaskDefinition{waitTask("hold", "fail", time.Hour)})

	e.executionsMu.Lock()
	delete(e.executions, "exec-1")
	e.executionsMu.Unlock()

	e.expireTimedOutWaits(time.Now())

	if waitingCount(e) != 0 {
		t.Errorf("%d waiters left for a run that no longer exists, want 0", waitingCount(e))
	}
	e.waitingMu.RLock()
	defer e.waitingMu.RUnlock()
	if _, ok := e.waitingExecutions["channel.follow"]; ok {
		t.Error("the event key is left behind once its last waiter goes")
	}
}
