package engine

import (
	"context"
	"errors"
	"fmt"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"

	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// Outcomes a run is counted under. They are the run's terminal status, except
// that a failure caused by a wait timeout is told apart as its own.
const (
	runOutcomeCompleted = "completed"
	runOutcomeFailed    = "failed"
	runOutcomeCancelled = "cancelled"
	runOutcomeTimedOut  = "timed_out"
)

// unknownStepAction names a step whose workflow is no longer registered by
// the time the step settles.
const unknownStepAction = "unknown"

// errWaitTimeout fails a run whose wait step timed out with onTimeout "fail".
var errWaitTimeout = errors.New("wait timeout")

// engineMetrics is what the engine reports: runs by outcome, how long they
// took, how many are in flight, and how long each step took.
//
// `trigger.type` is the triggering event's type, a bounded catalog subject.
// Workflow, run and viewer ids stay off every attribute.
type engineMetrics struct {
	runs         metric.Int64Counter
	runDuration  metric.Float64Histogram
	runsActive   metric.Int64UpDownCounter
	stepDuration metric.Float64Histogram
}

func newEngineMetrics(meter metric.Meter, shortBuckets, longBuckets []float64) (*engineMetrics, error) {
	runs, err := meter.Int64Counter("woofx3.workflow.runs",
		metric.WithDescription("Workflow runs that reached a final state."),
		metric.WithUnit("{run}"))
	if err != nil {
		return nil, fmt.Errorf("creating workflow runs counter: %w", err)
	}
	runDuration, err := meter.Float64Histogram("woofx3.workflow.run.duration",
		metric.WithDescription("Time from a run starting to its final state."),
		metric.WithUnit("s"),
		metric.WithExplicitBucketBoundaries(longBuckets...))
	if err != nil {
		return nil, fmt.Errorf("creating workflow run duration histogram: %w", err)
	}
	runsActive, err := meter.Int64UpDownCounter("woofx3.workflow.runs.active",
		metric.WithDescription("Workflow runs started and not yet in a final state."),
		metric.WithUnit("{run}"))
	if err != nil {
		return nil, fmt.Errorf("creating active workflow runs counter: %w", err)
	}
	stepDuration, err := meter.Float64Histogram("woofx3.workflow.step.duration",
		metric.WithDescription("Time a workflow step took to settle."),
		metric.WithUnit("s"),
		metric.WithExplicitBucketBoundaries(shortBuckets...))
	if err != nil {
		return nil, fmt.Errorf("creating workflow step duration histogram: %w", err)
	}
	return &engineMetrics{runs: runs, runDuration: runDuration, runsActive: runsActive, stepDuration: stepDuration}, nil
}

// runStarted counts a run as active. Dry runs are not real runs and are left out.
func (m *engineMetrics) runStarted(execution *types.WorkflowExecution) {
	if m == nil || execution.DryRun {
		return
	}
	m.runsActive.Add(context.Background(), 1)
}

// runSettled counts a run's outcome and duration and takes it off the active count.
func (m *engineMetrics) runSettled(execution *types.WorkflowExecution, status types.ExecutionStatus, cause error, duration time.Duration) {
	if m == nil || execution.DryRun {
		return
	}
	outcome := runOutcome(status, cause)
	ctx := context.Background()
	m.runsActive.Add(ctx, -1)
	m.runs.Add(ctx, 1, metric.WithAttributes(
		attribute.String("outcome", outcome),
		attribute.String("trigger.type", triggerType(execution)),
	))
	m.runDuration.Record(ctx, duration.Seconds(), metric.WithAttributes(attribute.String("outcome", outcome)))
}

// stepSettled records how long a step took. Skipped steps did no work and are
// not timed.
func (m *engineMetrics) stepSettled(action string, taskExec *types.TaskExecution) {
	if m == nil || taskExec == nil || taskExec.CompletedAt == nil || taskExec.Status == types.TaskStatusSkipped {
		return
	}
	m.stepDuration.Record(context.Background(), taskExec.CompletedAt.Sub(taskExec.StartedAt).Seconds(),
		metric.WithAttributes(
			attribute.String("step.action", action),
			attribute.String("outcome", string(taskExec.Status)),
		))
}

func runOutcome(status types.ExecutionStatus, cause error) string {
	switch {
	case status == types.ExecutionStatusFailed && errors.Is(cause, errWaitTimeout):
		return runOutcomeTimedOut
	case status == types.ExecutionStatusCompleted:
		return runOutcomeCompleted
	case status == types.ExecutionStatusCancelled:
		return runOutcomeCancelled
	default:
		return runOutcomeFailed
	}
}

func triggerType(execution *types.WorkflowExecution) string {
	if execution.TriggerEvent == nil {
		return "none"
	}
	return execution.TriggerEvent.Type
}

// stepAction names what a step runs: the registered action for an action
// step, the task type for the others. Both are bounded sets.
func (e *Engine[TServices]) stepAction(workflowID, taskID string) string {
	def, err := e.workflowRegistry.Get(workflowID)
	if err != nil {
		return unknownStepAction
	}
	for _, task := range def.Tasks {
		if task.ID != taskID {
			continue
		}
		if task.Type == types.TaskTypeAction {
			return task.Action
		}
		return string(task.Type)
	}
	return unknownStepAction
}

// SetMetrics reports the engine's runs and steps through meter. Without it the
// engine reports nothing.
func (e *Engine[TServices]) SetMetrics(meter metric.Meter, shortBuckets, longBuckets []float64) error {
	m, err := newEngineMetrics(meter, shortBuckets, longBuckets)
	if err != nil {
		return err
	}
	e.metrics = m
	return nil
}
