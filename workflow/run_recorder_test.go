package main

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	dbv1 "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/workflow/internal/engine"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// stubRunStore captures what the recorder would have written.
type stubRunStore struct {
	runs    []*dbv1.RecordWorkflowRunRequest
	updates []*dbv1.UpdateWorkflowRunStatusRequest
	steps   []*dbv1.RecordWorkflowRunStepRequest
}

func (s *stubRunStore) RecordWorkflowRun(_ context.Context, req *dbv1.RecordWorkflowRunRequest) (*dbv1.WorkflowExecutionResponse, error) {
	s.runs = append(s.runs, req)
	return &dbv1.WorkflowExecutionResponse{}, nil
}

func (s *stubRunStore) UpdateWorkflowRunStatus(_ context.Context, req *dbv1.UpdateWorkflowRunStatusRequest) (*dbv1.WorkflowExecutionResponse, error) {
	s.updates = append(s.updates, req)
	return &dbv1.WorkflowExecutionResponse{}, nil
}

func (s *stubRunStore) RecordWorkflowRunStep(_ context.Context, req *dbv1.RecordWorkflowRunStepRequest) (*dbv1.ResponseStatus, error) {
	s.steps = append(s.steps, req)
	return &dbv1.ResponseStatus{}, nil
}

func recorderFixture() (*dbRunRecorder, *stubRunStore) {
	store := &stubRunStore{}
	return newDBRunRecorder(store, &executeEventLogger{}), store
}

func runWith(triggeredBy string) *types.WorkflowExecution {
	return &types.WorkflowExecution{
		ID:         "exec-1",
		WorkflowID: "wf-1",
		Status:     types.ExecutionStatusRunning,
		StartedAt:  time.Now(),
		TriggerEvent: &types.Event{
			ID:          "ev-1",
			Type:        "channel.follow",
			Source:      "twitch",
			TriggeredBy: triggeredBy,
		},
	}
}

// The whole ephemeral/system policy rests on this one predicate: a run fired by
// hand is already being watched live, so it is not written down.
func TestRecorderSkipsDashboardRuns(t *testing.T) {
	recorder, store := recorderFixture()
	execution := runWith(dashboardOrigin)

	recorder.RunStarted(execution)
	recorder.RunSettled(execution)
	recorder.StepSettled(execution, engine.RunStep{TaskID: "t1"})

	if len(store.runs) != 0 || len(store.updates) != 0 || len(store.steps) != 0 {
		t.Fatalf("dashboard run was recorded: runs=%d updates=%d steps=%d",
			len(store.runs), len(store.updates), len(store.steps))
	}
}

func TestRecorderRecordsSystemRuns(t *testing.T) {
	recorder, store := recorderFixture()
	execution := runWith("twitch")

	recorder.RunStarted(execution)

	if len(store.runs) != 1 {
		t.Fatalf("expected one recorded run, got %d", len(store.runs))
	}
	got := store.runs[0]
	if got.Id != "exec-1" || got.WorkflowId != "wf-1" {
		t.Errorf("run recorded with wrong identity: %+v", got)
	}
	if got.TriggeredBy != "twitch" {
		t.Errorf("TriggeredBy = %q, want twitch", got.TriggeredBy)
	}

	// The trigger event is what a replay re-feeds, so it has to survive intact.
	var decoded types.Event
	if err := json.Unmarshal([]byte(got.TriggerEventJson), &decoded); err != nil {
		t.Fatalf("trigger event not valid JSON: %v", err)
	}
	if decoded.ID != "ev-1" || decoded.Type != "channel.follow" {
		t.Errorf("trigger event did not round-trip: %+v", decoded)
	}
}

// A nil *types.Event inside an `any` is not equal to nil, so the careless form
// serialises the string "null" into the column a replay treats as its source of
// truth. Empty is the honest answer.
func TestRecorderHandlesMissingTriggerEvent(t *testing.T) {
	recorder, store := recorderFixture()
	execution := &types.WorkflowExecution{
		ID:         "exec-2",
		WorkflowID: "wf-1",
		Status:     types.ExecutionStatusRunning,
		StartedAt:  time.Now(),
	}

	recorder.RunStarted(execution)

	if len(store.runs) != 1 {
		t.Fatalf("expected one recorded run, got %d", len(store.runs))
	}
	if got := store.runs[0].TriggerEventJson; got != "" {
		t.Errorf("TriggerEventJson = %q, want empty", got)
	}
}

func TestRecorderRecordsTerminalOutcome(t *testing.T) {
	recorder, store := recorderFixture()
	execution := runWith("twitch")
	execution.Status = types.ExecutionStatusFailed
	execution.Error = "alert cannot be published: layout must be an object, got nothing"
	completed := time.Now()
	execution.CompletedAt = &completed

	recorder.RunSettled(execution)

	if len(store.updates) != 1 {
		t.Fatalf("expected one update, got %d", len(store.updates))
	}
	got := store.updates[0]
	if got.Status != "failed" {
		t.Errorf("Status = %q, want failed", got.Status)
	}
	if got.Error != execution.Error {
		t.Errorf("Error = %q, want the engine's own reason", got.Error)
	}
	if got.CompletedAt == nil {
		t.Error("terminal outcome recorded without a completion time")
	}
}

func TestRecorderStepCarriesInputsAndOutputs(t *testing.T) {
	recorder, store := recorderFixture()
	execution := runWith("twitch")
	started := time.Now()
	completed := started.Add(250 * time.Millisecond)

	recorder.StepSettled(execution, engine.RunStep{
		TaskID:      "send-alert",
		Status:      "success",
		Attempt:     1,
		StepIndex:   2,
		Inputs:      map[string]any{"target": "sidebar"},
		Outputs:     map[string]any{"sent": true},
		StartedAt:   started,
		CompletedAt: &completed,
	})

	if len(store.steps) != 1 {
		t.Fatalf("expected one step, got %d", len(store.steps))
	}
	got := store.steps[0]
	if got.TaskId != "send-alert" || got.StepIndex != 2 || got.Attempt != 1 {
		t.Errorf("step recorded with wrong identity: %+v", got)
	}
	if got.InputsJson != `{"target":"sidebar"}` {
		t.Errorf("InputsJson = %q", got.InputsJson)
	}
	if got.OutputsJson != `{"sent":true}` {
		t.Errorf("OutputsJson = %q", got.OutputsJson)
	}
	// Derived rather than passed: the engine already knows both timestamps, and
	// a duration that disagrees with them would be worse than none.
	if got.DurationMs != 250 {
		t.Errorf("DurationMs = %d, want 250", got.DurationMs)
	}
}

// A step that never ran resolved no parameters. Recording it with empty inputs
// keeps it in the timeline -- that a branch was not taken is part of what the
// run did -- without inventing values it never had.
func TestRecorderStepWithoutPayloads(t *testing.T) {
	recorder, store := recorderFixture()

	recorder.StepSettled(runWith("twitch"), engine.RunStep{
		TaskID:    "skipped-step",
		Status:    "skipped",
		StepIndex: 1,
	})

	if len(store.steps) != 1 {
		t.Fatalf("expected one step, got %d", len(store.steps))
	}
	got := store.steps[0]
	if got.InputsJson != "" || got.OutputsJson != "" {
		t.Errorf("empty payloads were invented: inputs=%q outputs=%q", got.InputsJson, got.OutputsJson)
	}
	if got.CompletedAt != nil || got.DurationMs != 0 {
		t.Errorf("unfinished step got a completion: %+v", got)
	}
}
