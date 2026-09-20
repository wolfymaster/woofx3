package main

import (
	"context"
	"encoding/json"

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

// dbRunRecorder persists runs and their steps through the db proxy.
//
// Every method is best-effort: a failure is logged at warn and the run carries
// on. The engine holds no transaction here and the work has already happened,
// so a failed write costs history, not correctness -- the same trade
// recordAlertDispatch makes for the alert log.
type dbRunRecorder struct {
	client runStore
	logger tasks.Logger
}

func newDBRunRecorder(client runStore, logger tasks.Logger) *dbRunRecorder {
	return &dbRunRecorder{client: client, logger: logger}
}

func (r *dbRunRecorder) RunStarted(applicationID string, execution *types.WorkflowExecution) {
	if r.skip(execution) {
		return
	}

	_, err := r.client.RecordWorkflowRun(context.Background(), &dbv1.RecordWorkflowRunRequest{
		Id:               execution.ID,
		WorkflowId:       execution.WorkflowID,
		ApplicationId:    applicationID,
		TriggeredBy:      triggeredBy(execution),
		TriggerEventJson: r.triggerEventJSON(execution),
		StartedAt:        timestamppb.New(execution.StartedAt),
	})
	if err != nil {
		r.logger.Warn("workflow run not recorded",
			"execution", execution.ID,
			"workflow", execution.WorkflowID,
			"error", err)
	}
}

func (r *dbRunRecorder) RunSettled(applicationID string, execution *types.WorkflowExecution) {
	if r.skip(execution) {
		return
	}

	req := &dbv1.UpdateWorkflowRunStatusRequest{
		Id:     execution.ID,
		Status: string(execution.Status),
		Error:  execution.Error,
	}
	if execution.CompletedAt != nil {
		req.CompletedAt = timestamppb.New(*execution.CompletedAt)
	}

	if _, err := r.client.UpdateWorkflowRunStatus(context.Background(), req); err != nil {
		r.logger.Warn("workflow run outcome not recorded",
			"execution", execution.ID,
			"status", execution.Status,
			"error", err)
	}
}

func (r *dbRunRecorder) StepSettled(applicationID string, execution *types.WorkflowExecution, step engine.RunStep) {
	if r.skip(execution) {
		return
	}

	req := &dbv1.RecordWorkflowRunStepRequest{
		ExecutionId:   execution.ID,
		ApplicationId: applicationID,
		TaskId:        step.TaskID,
		Name:          step.TaskID,
		Status:        step.Status,
		Attempt:       int32(step.Attempt),
		StepIndex:     int32(step.StepIndex),
		InputsJson:    r.marshalMap(step.Inputs, "step inputs"),
		OutputsJson:   r.marshalMap(step.Outputs, "step outputs"),
		Error:         step.Error,
		StartedAt:     timestamppb.New(step.StartedAt),
	}
	if step.CompletedAt != nil {
		req.CompletedAt = timestamppb.New(*step.CompletedAt)
		req.DurationMs = step.CompletedAt.Sub(step.StartedAt).Milliseconds()
	}

	if _, err := r.client.RecordWorkflowRunStep(context.Background(), req); err != nil {
		r.logger.Warn("workflow run step not recorded",
			"execution", execution.ID,
			"task", step.TaskID,
			"error", err)
	}
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
