package engine

import (
	"fmt"
	"runtime/debug"

	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// runRef names the run a goroutine works on, so a panic there can be pinned
// to that run and settle it. The zero value names no run: a goroutine that
// serves several runs, such as an event's ordered queue, has none of its own.
type runRef struct {
	workflowID  string
	executionID string
}

func refTo(execution *types.WorkflowExecution) runRef {
	return runRef{workflowID: execution.WorkflowID, executionID: execution.ID}
}

// panicError is the reason a run or task fails with when code under it
// panicked. It names where, not what: the panic value and stack go to the
// log, which is for operators, while this reason is recorded and published.
func panicError(where string) error {
	return fmt.Errorf("internal error: panic in %s", where)
}

// safeGo launches fn on its own goroutine under guard.
//
// Every goroutine the engine starts for a run goes through here or guard. A
// panic on a bare goroutine ends the whole process, and with it every run in
// memory, for one bad step.
func (e *Engine[TServices]) safeGo(name string, run runRef, fn func()) {
	go e.guard(name, run, fn)
}

// guard runs fn and recovers a panic in it: the panic is logged at Error with
// its stack, and the run it belongs to fails so it settles, is recorded, and
// releases a parent waiting on it. A panic is still a bug; recovering keeps it
// from taking down every other run while it is fixed.
//
// For callbacks the runtime already runs on a goroutine of their own, such as
// a wait's timer.
func (e *Engine[TServices]) guard(name string, run runRef, fn func()) {
	defer e.recoverRun(name, run)
	fn()
}

// recoverRun must be deferred directly: recover only stops a panic when the
// deferred function itself calls it.
func (e *Engine[TServices]) recoverRun(name string, run runRef) {
	recovered := recover()
	if recovered == nil {
		return
	}
	e.logPanic(name, run, recovered)
	if run.executionID == "" {
		return
	}

	e.executionsMu.RLock()
	execution := e.executions[run.executionID]
	e.executionsMu.RUnlock()
	if execution == nil {
		return
	}
	// A run that settled before the panic keeps its outcome: claimSettle
	// refuses a second one.
	e.setExecutionStatus(execution, types.ExecutionStatusFailed, panicError(name))
	e.checkSubWorkflowCompletion(execution.ID)
}

// executeTaskGuarded is executeTask for a task's own goroutine. A panic in the
// task becomes the task's error, so the run goroutine waiting on the result
// fails the step and the run the way any failing task does, instead of waiting
// for a result that never comes.
func (e *Engine[TServices]) executeTaskGuarded(
	taskDef *types.TaskDefinition,
	execution *types.WorkflowExecution,
	event *types.Event,
	taskExports map[string]map[string]any,
) (result *types.TaskResult, params map[string]any, err error) {
	defer func() {
		recovered := recover()
		if recovered == nil {
			return
		}
		where := fmt.Sprintf("task %s", taskDef.ID)
		e.logPanic(where, refTo(execution), recovered)
		result, params, err = nil, nil, panicError(where)
	}()
	return e.executeTask(taskDef, execution, event, taskExports)
}

func (e *Engine[TServices]) logPanic(where string, run runRef, recovered any) {
	e.logger.Error("Recovered panic in workflow engine",
		"in", where,
		"workflow", run.workflowID,
		"execution", run.executionID,
		"panic", fmt.Sprint(recovered),
		"stack", string(debug.Stack()))
}
