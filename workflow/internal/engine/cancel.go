package engine

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// ErrExecutionNotFound is returned for a run this engine has no record of: an
// id that never existed, or a run started before this process did.
var ErrExecutionNotFound = errors.New("execution not found")

// errRunCancelled is what an abandoned task reports in place of its result.
var errRunCancelled = errors.New("run cancelled")

// CancelOutcome is what a cancel request did.
type CancelOutcome string

const (
	// CancelOutcomeCancelled: the run has been told to stop and will settle
	// as cancelled, or already has because of an earlier cancel.
	CancelOutcomeCancelled CancelOutcome = "cancelled"
	// CancelOutcomeAlreadyFinished: the run had settled as completed or
	// failed before the request arrived; nothing was changed.
	CancelOutcomeAlreadyFinished CancelOutcome = "already_finished"
)

// CancelResult reports a cancel request's outcome and the run's status after
// it. Status is the settled status for a finished run, and "cancelled" for a
// run the request stopped, even if the run is still unwinding.
type CancelResult struct {
	Outcome CancelOutcome
	Status  types.ExecutionStatus
}

// runControl is one run's cancellation state.
//
// `settled` is what makes a run end exactly once. Cancel and the goroutine
// running the tasks can both try to settle it, and a run that settles twice
// announces two outcomes; whoever flips `settled` first decides, and the other
// backs off.
type runControl struct {
	ctx    context.Context
	cancel context.CancelFunc

	mu              sync.Mutex
	settled         bool
	finalStatus     types.ExecutionStatus
	cancelRequested bool
	reason          string
	// stopped marks a run the engine abandoned because it was stopping. Such a
	// run unwinds the way a cancelled one does, but nobody asked for it to
	// stop, so it settles as failed rather than cancelled.
	stopped bool

	// viewer loads the run's `${viewer.*}` data. Kept here, beside the rest of
	// the run's lifetime state, so every step and a resume after a wait share
	// one read.
	viewer func() any
}

// claimSettle marks the run settled with `status`, or reports that it already
// was. Once a cancel has been accepted every later outcome becomes cancelled:
// the caller was told the run would stop, and a run finishing its last step in
// the instant after that is still a run somebody stopped.
func (c *runControl) claimSettle(status types.ExecutionStatus, err error) (types.ExecutionStatus, error, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.settled {
		return c.finalStatus, nil, false
	}
	if c.cancelRequested && status != types.ExecutionStatusCancelled {
		status = types.ExecutionStatusCancelled
		err = cancelError(c.reason)
	} else if c.stopped && !c.cancelRequested && status == types.ExecutionStatusCancelled {
		// Only the abandonment is renamed. A run that finished or failed on its
		// own while the engine was stopping keeps the outcome it reached.
		status = types.ExecutionStatusFailed
		err = errEngineStopped
	}
	c.settled = true
	c.finalStatus = status
	return status, err, true
}

// abandonedBy is what a task the run gave up on reports: the engine stopping,
// or a cancel.
func (c *runControl) abandonedBy() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.stopped && !c.cancelRequested {
		return errEngineStopped
	}
	return errRunCancelled
}

// markStopped records that the engine gave up on the run, and reports whether
// this call was the one that did.
func (c *runControl) markStopped() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.stopped || c.settled {
		return false
	}
	c.stopped = true
	return true
}

func (c *runControl) isSettled() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.settled
}

func cancelError(reason string) error {
	return fmt.Errorf("cancelled: %s", reason)
}

func isTerminalStatus(status types.ExecutionStatus) bool {
	switch status {
	case types.ExecutionStatusCompleted, types.ExecutionStatusFailed, types.ExecutionStatusCancelled:
		return true
	}
	return false
}

// registerRun gives a new run its cancellation state and its `${viewer.*}`
// loader. Caller holds executionsMu.
//
// Each run's context derives from Background rather than the engine's own:
// Stop ends the engine, and it is not a request to cancel every run in flight,
// which would record as cancelled runs nobody asked to stop. Stop gives runs
// time to finish and abandons the rest one by one (see abandonRun).
func (e *Engine[TServices]) registerRunLocked(executionID string, viewer func() any) {
	if viewer == nil {
		panic(fmt.Sprintf("engine: run %s registered without a viewer loader", executionID))
	}
	ctx, cancel := context.WithCancel(context.Background())
	e.controls[executionID] = &runControl{ctx: ctx, cancel: cancel, viewer: viewer}
}

func (e *Engine[TServices]) control(executionID string) *runControl {
	e.executionsMu.RLock()
	defer e.executionsMu.RUnlock()
	return e.controls[executionID]
}

// runContext is the context a run's tasks see. A run with no control -- one
// built by hand in a test -- is never cancelled.
func (e *Engine[TServices]) runContext(executionID string) context.Context {
	if ctl := e.control(executionID); ctl != nil {
		return ctl.ctx
	}
	return context.Background()
}

func (e *Engine[TServices]) runCancelled(executionID string) bool {
	return e.runContext(executionID).Err() != nil
}

// Cancel stops a run.
//
// A run executing a task stops waiting for it: the task's result is
// abandoned, not undone, so an action already sent to its service may still
// take effect. A run paused at a wait or on a sub-workflow is claimed here and
// settled at once, and a sub-workflow it was waiting on is cancelled with it.
// Either way the run settles as cancelled through setExecutionStatus, which
// records it and announces it like any other outcome.
//
// Idempotent: cancelling a run that is already cancelled, or already being
// cancelled, reports cancelled again and changes nothing.
func (e *Engine[TServices]) Cancel(executionID, reason string) (CancelResult, error) {
	if reason == "" {
		reason = "cancelled by user"
	}

	e.executionsMu.RLock()
	execution := e.executions[executionID]
	ctl := e.controls[executionID]
	e.executionsMu.RUnlock()
	if execution == nil || ctl == nil {
		return CancelResult{}, fmt.Errorf("%w: %s", ErrExecutionNotFound, executionID)
	}

	ctl.mu.Lock()
	if ctl.settled {
		status := ctl.finalStatus
		ctl.mu.Unlock()
		if status == types.ExecutionStatusCancelled {
			return CancelResult{Outcome: CancelOutcomeCancelled, Status: status}, nil
		}
		return CancelResult{Outcome: CancelOutcomeAlreadyFinished, Status: status}, nil
	}
	if ctl.cancelRequested {
		ctl.mu.Unlock()
		return CancelResult{Outcome: CancelOutcomeCancelled, Status: types.ExecutionStatusCancelled}, nil
	}
	ctl.cancelRequested = true
	ctl.reason = reason
	ctl.mu.Unlock()

	e.logger.Info("Cancelling workflow run", "workflow", execution.WorkflowID, "execution", executionID, "reason", reason)

	e.abandonRun(execution, ctl, func(childID string) {
		if _, err := e.Cancel(childID, "parent run cancelled"); err != nil {
			e.logger.Warn("Sub-workflow run not cancelled", "execution", childID, "error", err)
		}
	})

	return CancelResult{Outcome: CancelOutcomeCancelled, Status: types.ExecutionStatusCancelled}, nil
}

// abandonRun makes a run stop where it is, for a cancel or for the engine
// stopping; the run's control already says which. A run paused at a wait or
// on a sub-workflow has no goroutine to notice, so it is claimed and settled
// here. abandonChild is called for each sub-workflow a paused run was waiting
// on, and may be nil when the caller deals with those runs itself.
func (e *Engine[TServices]) abandonRun(execution *types.WorkflowExecution, ctl *runControl, abandonChild func(childID string)) {
	// Cancelled before any wait is claimed. A wait is armed under the same lock
	// the claim takes, and arming checks this context, so a run reaching a wait
	// concurrently either is claimed below or refuses to pause.
	ctl.cancel()

	if waits := e.claimWaits(execution.ID); len(waits) > 0 {
		for _, w := range waits {
			e.cancelPendingTask(execution, w.TaskID, w.CurrentIndex)
		}
		e.settleCancelled(execution)
	} else if waiters := e.claimSubWorkflowWaiters(execution.ID); len(waiters) > 0 {
		for childID, w := range waiters {
			e.cancelPendingTask(execution, w.TaskID, w.CurrentIndex)
			if abandonChild != nil {
				abandonChild(childID)
			}
		}
		e.settleCancelled(execution)
	}
	// Otherwise a goroutine is running the run's tasks. It sees the context
	// done, abandons the task in flight, and settles the run itself.
}

// claimWaits claims every wait the run has armed, event or delay, and returns
// them. Removal from armedWaits under waitingMu is the claim, the same one an
// event, a wait's timer and Stop make: each stops the wait's timer, and an
// event or timer arriving afterwards finds nothing to resume.
func (e *Engine[TServices]) claimWaits(executionID string) []*WaitingExecution {
	e.waitingMu.Lock()
	defer e.waitingMu.Unlock()

	var claimed []*WaitingExecution
	for w := range e.armedWaits {
		if w.ExecutionID != executionID {
			continue
		}
		e.disarmWaitLocked(w)
		if !tasks.IsDelay(w.TaskDef.Wait) {
			event := w.TaskDef.Wait.Event
			e.waitingExecutions[event] = removeWaitingExecution(e.waitingExecutions[event], w)
			if len(e.waitingExecutions[event]) == 0 {
				delete(e.waitingExecutions, event)
			}
		}
		claimed = append(claimed, w)
	}
	return claimed
}

// claimSubWorkflowWaiters removes the run's registrations as a parent waiting
// on a sub-workflow, keyed by the sub-workflow's execution id.
func (e *Engine[TServices]) claimSubWorkflowWaiters(executionID string) map[string]*SubWorkflowWaiter {
	e.subWorkflowWaitersMu.Lock()
	defer e.subWorkflowWaitersMu.Unlock()

	claimed := make(map[string]*SubWorkflowWaiter)
	for childID, list := range e.subWorkflowWaiters {
		kept := list[:0]
		for _, w := range list {
			if w.ParentExecutionID == executionID {
				claimed[childID] = w
				continue
			}
			kept = append(kept, w)
		}
		if len(kept) == 0 {
			delete(e.subWorkflowWaiters, childID)
		} else {
			e.subWorkflowWaiters[childID] = kept
		}
	}
	return claimed
}

// cancelPendingTask settles a task the run was abandoned during and records it.
func (e *Engine[TServices]) cancelPendingTask(execution *types.WorkflowExecution, taskID string, index int) {
	taskExec := execution.Tasks[taskID]
	if taskExec == nil {
		taskExec = &types.TaskExecution{TaskID: taskID, StartedAt: time.Now()}
		execution.Tasks[taskID] = taskExec
	}
	reason := errRunCancelled
	if ctl := e.control(execution.ID); ctl != nil {
		reason = ctl.abandonedBy()
	}
	now := time.Now()
	taskExec.Status = types.TaskStatusCancelled
	taskExec.Error = reason.Error()
	taskExec.CompletedAt = &now
	e.recordStep(execution, taskID, index, nil, taskExec)
}

// settleCancelled ends an abandoned run and releases anything waiting on it.
// The run settles as cancelled, unless it was the engine stopping that
// abandoned it: claimSettle then records it as failed.
func (e *Engine[TServices]) settleCancelled(execution *types.WorkflowExecution) {
	reason := "cancelled by user"
	if ctl := e.control(execution.ID); ctl != nil {
		ctl.mu.Lock()
		reason = ctl.reason
		ctl.mu.Unlock()
	}
	e.setExecutionStatus(execution, types.ExecutionStatusCancelled, cancelError(reason))
	e.logger.Info("Workflow run abandoned", "workflow", execution.WorkflowID, "execution", execution.ID, "status", execution.Status)
	e.checkSubWorkflowCompletion(execution.ID)
}

// stopIfCancelled settles the run as cancelled when a cancel has been
// accepted, and reports whether it did. Checked between tasks, so a run that
// was cancelled while no task was in flight stops before starting another.
func (e *Engine[TServices]) stopIfCancelled(execution *types.WorkflowExecution) bool {
	if !e.runCancelled(execution.ID) {
		return false
	}
	e.settleCancelled(execution)
	return true
}

type taskOutcome struct {
	result *types.TaskResult
	params map[string]any
	err    error
}

// executeTaskCancellable runs a task and returns its outcome, or
// errRunCancelled as soon as the run is cancelled.
//
// The task keeps running on its own goroutine after a cancel, because there is
// no way to stop a function that ignores its context. Its result is discarded:
// nothing reads it, and the run has already moved on to settling.
func (e *Engine[TServices]) executeTaskCancellable(
	taskDef *types.TaskDefinition,
	execution *types.WorkflowExecution,
	event *types.Event,
	taskExports map[string]map[string]any,
) (*types.TaskResult, map[string]any, error) {
	ctx := e.runContext(execution.ID)
	done := make(chan taskOutcome, 1)
	go func() {
		result, params, err := e.executeTask(taskDef, execution, event, taskExports)
		done <- taskOutcome{result: result, params: params, err: err}
	}()
	select {
	case out := <-done:
		return out.result, out.params, out.err
	case <-ctx.Done():
		return nil, nil, errRunCancelled
	}
}
