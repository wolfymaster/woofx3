package main

import (
	"context"
	"encoding/json"
	"time"

	dbv1 "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/workflow/internal/engine"
	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// dashboardOrigin marks a run someone fired by hand from the dashboard.
//
// Those runs are deliberately not recorded. Whoever started one is already
// watching it live through transientEvents, and writing a row for every test
// fire would bury the history in runs nobody returns to. Everything else -- a
// Twitch event, a chat command, a schedule -- happens with no audience at all,
// which is precisely why it is the kind worth writing down.
const dashboardOrigin = "dashboard"

// runStore is the slice of the db proxy's workflow service this recorder uses.
//
// Narrowed deliberately: dbv1.WorkflowService carries a dozen methods for
// workflow CRUD that run recording has no business calling, and depending on
// the whole thing would force any test double to implement all twelve to
// exercise three. dbv1.WorkflowService satisfies this as-is.
type runStore interface {
	RecordWorkflowRun(context.Context, *dbv1.RecordWorkflowRunRequest) (*dbv1.WorkflowExecutionResponse, error)
	UpdateWorkflowRunStatus(context.Context, *dbv1.UpdateWorkflowRunStatusRequest) (*dbv1.WorkflowExecutionResponse, error)
	RecordWorkflowRunStep(context.Context, *dbv1.RecordWorkflowRunStepRequest) (*dbv1.ResponseStatus, error)
}

// dbRunRecorder turns what the engine reports about a run into db proxy
// requests, and writes them.
//
// The two halves are separate on purpose. A request is captured while the
// engine reports the change, because the execution it reads from keeps
// changing as the run goes on; it is written later, by asyncRunRecorder's
// writer, so that the run never waits on the db proxy.
//
// Every write is best-effort: a failure is logged at warn and the run carries
// on. The engine holds no transaction here and the work has already happened,
// so a failed write costs history, not correctness -- the same trade
// recordAlertDispatch makes for the alert log.
type dbRunRecorder struct {
	client runStore
	logger tasks.Logger
	// callTimeout bounds each write, so one request the db proxy never answers
	// cannot hold up every write queued behind it.
	callTimeout time.Duration
}

func newDBRunRecorder(client runStore, logger tasks.Logger, callTimeout time.Duration) *dbRunRecorder {
	return &dbRunRecorder{client: client, logger: logger, callTimeout: callTimeout}
}

// runWrite is one captured request to the db proxy's run history.
type runWrite interface {
	apply(ctx context.Context, store runStore) error
	logFailure(logger tasks.Logger, err error)
}

type runStartedWrite struct {
	req *dbv1.RecordWorkflowRunRequest
}

func (w runStartedWrite) apply(ctx context.Context, store runStore) error {
	_, err := store.RecordWorkflowRun(ctx, w.req)
	return err
}

func (w runStartedWrite) logFailure(logger tasks.Logger, err error) {
	logger.Warn("workflow run not recorded",
		"execution", w.req.Id,
		"workflow", w.req.WorkflowId,
		"error", err)
}

type runSettledWrite struct {
	req *dbv1.UpdateWorkflowRunStatusRequest
}

func (w runSettledWrite) apply(ctx context.Context, store runStore) error {
	_, err := store.UpdateWorkflowRunStatus(ctx, w.req)
	return err
}

func (w runSettledWrite) logFailure(logger tasks.Logger, err error) {
	logger.Warn("workflow run outcome not recorded",
		"execution", w.req.Id,
		"status", w.req.Status,
		"error", err)
}

type stepSettledWrite struct {
	req *dbv1.RecordWorkflowRunStepRequest
}

func (w stepSettledWrite) apply(ctx context.Context, store runStore) error {
	_, err := store.RecordWorkflowRunStep(ctx, w.req)
	return err
}

func (w stepSettledWrite) logFailure(logger tasks.Logger, err error) {
	logger.Warn("workflow run step not recorded",
		"execution", w.req.ExecutionId,
		"task", w.req.TaskId,
		"error", err)
}

// write sends one captured request, giving up after callTimeout or when ctx
// ends.
func (r *dbRunRecorder) write(ctx context.Context, w runWrite) {
	callCtx, cancel := context.WithTimeout(ctx, r.callTimeout)
	defer cancel()
	if err := w.apply(callCtx, r.client); err != nil {
		w.logFailure(r.logger, err)
	}
}

// runStarted captures the run row, or nil for a run that is not kept.
func (r *dbRunRecorder) runStarted(execution *types.WorkflowExecution) runWrite {
	if r.skip(execution) {
		return nil
	}
	return runStartedWrite{req: &dbv1.RecordWorkflowRunRequest{
		Id:               execution.ID,
		WorkflowId:       execution.WorkflowID,
		TriggeredBy:      triggeredBy(execution),
		TriggerEventJson: r.triggerEventJSON(execution),
		StartedAt:        timestamppb.New(execution.StartedAt),
		DryRun:           execution.DryRun,
	}}
}

// runSettled captures the run's outcome, or nil for a run that is not kept.
func (r *dbRunRecorder) runSettled(execution *types.WorkflowExecution) runWrite {
	if r.skip(execution) {
		return nil
	}
	req := &dbv1.UpdateWorkflowRunStatusRequest{
		Id:     execution.ID,
		Status: string(execution.Status),
		Error:  execution.Error,
	}
	if execution.CompletedAt != nil {
		req.CompletedAt = timestamppb.New(*execution.CompletedAt)
	}
	return runSettledWrite{req: req}
}

// stepSettled captures one step row, or nil for a run that is not kept.
func (r *dbRunRecorder) stepSettled(execution *types.WorkflowExecution, step engine.RunStep) runWrite {
	if r.skip(execution) {
		return nil
	}
	req := &dbv1.RecordWorkflowRunStepRequest{
		ExecutionId: execution.ID,
		TaskId:      step.TaskID,
		Name:        step.TaskID,
		Status:      step.Status,
		Attempt:     int32(step.Attempt),
		StepIndex:   int32(step.StepIndex),
		InputsJson:  r.marshalMap(step.Inputs, "step inputs"),
		OutputsJson: r.marshalMap(step.Outputs, "step outputs"),
		Error:       step.Error,
		StartedAt:   timestamppb.New(step.StartedAt),
	}
	if step.CompletedAt != nil {
		req.CompletedAt = timestamppb.New(*step.CompletedAt)
		req.DurationMs = step.CompletedAt.Sub(step.StartedAt).Milliseconds()
	}
	return stepSettledWrite{req: req}
}

// skip decides whether this run is one we keep.
func (r *dbRunRecorder) skip(execution *types.WorkflowExecution) bool {
	return r.client == nil || execution == nil || triggeredBy(execution) == dashboardOrigin
}

func triggeredBy(execution *types.WorkflowExecution) string {
	if execution == nil || execution.TriggerEvent == nil {
		return ""
	}
	return execution.TriggerEvent.TriggeredBy
}

// triggerEventJSON serialises the event a run started from.
//
// The nil check is on the concrete field, before anything is widened to an
// interface. A nil *types.Event inside an `any` is not equal to nil, so the
// widened form would serialise the string "null" into the column a replay
// later reads as its source of truth.
func (r *dbRunRecorder) triggerEventJSON(execution *types.WorkflowExecution) string {
	if execution.TriggerEvent == nil {
		return ""
	}
	raw, err := json.Marshal(execution.TriggerEvent)
	if err != nil {
		r.logger.Warn("trigger event not serialisable", "execution", execution.ID, "error", err)
		return ""
	}
	return string(raw)
}

// marshalMap renders a step payload for a JSON column, or empty when there is
// nothing to render.
//
// Takes a concrete map rather than `any` for the same reason triggerEventJSON
// checks its field first: a nil map widened to an interface is not equal to
// nil, so the obvious guard would let it through to json.Marshal and write
// "null" where the column should simply be empty. Keeping the parameter
// concrete means the mistake cannot be made here at all.
func (r *dbRunRecorder) marshalMap(payload map[string]any, what string) string {
	if len(payload) == 0 {
		return ""
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		r.logger.Warn("workflow run payload not serialisable", "payload", what, "error", err)
		return ""
	}
	return string(raw)
}
