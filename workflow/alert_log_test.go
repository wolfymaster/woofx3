package main

import (
	"context"
	"fmt"
	"testing"

	dbv1 "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// stubAlertService records what the alert action asked the log to store, and
// can be told to fail. It implements the whole dbv1.AlertService surface
// because the interface requires it; only CreateAlert is exercised.
type stubAlertService struct {
	created []*dbv1.CreateAlertRequest
	err     error
}

func (s *stubAlertService) CreateAlert(_ context.Context, req *dbv1.CreateAlertRequest) (*dbv1.AlertResponse, error) {
	s.created = append(s.created, req)
	if s.err != nil {
		return nil, s.err
	}
	return &dbv1.AlertResponse{Status: &dbv1.ResponseStatus{Code: dbv1.ResponseStatus_OK}}, nil
}

func (s *stubAlertService) GetAlert(context.Context, *dbv1.GetAlertRequest) (*dbv1.AlertResponse, error) {
	return nil, fmt.Errorf("not exercised")
}

func (s *stubAlertService) GetAlertByEnvelopeId(context.Context, *dbv1.GetAlertByEnvelopeIdRequest) (*dbv1.AlertResponse, error) {
	return nil, fmt.Errorf("not exercised")
}

func (s *stubAlertService) ListAlerts(context.Context, *dbv1.ListAlertsRequest) (*dbv1.ListAlertsResponse, error) {
	return nil, fmt.Errorf("not exercised")
}

func (s *stubAlertService) UpdateAlertStatus(context.Context, *dbv1.UpdateAlertStatusRequest) (*dbv1.AlertResponse, error) {
	return nil, fmt.Errorf("not exercised")
}

func (s *stubAlertService) UpdateAlertLifecycle(context.Context, *dbv1.UpdateAlertLifecycleRequest) (*dbv1.AlertResponse, error) {
	return nil, fmt.Errorf("not exercised")
}

func (s *stubAlertService) DeleteAlert(context.Context, *dbv1.DeleteAlertRequest) (*dbv1.ResponseStatus, error) {
	return nil, fmt.Errorf("not exercised")
}

type recordingLogger struct {
	warns []string
}

func (l *recordingLogger) Info(string, ...any)  {}
func (l *recordingLogger) Error(string, ...any) {}
func (l *recordingLogger) Debug(string, ...any) {}
func (l *recordingLogger) Warn(message string, _ ...any) {
	l.warns = append(l.warns, message)
}

func alertContext(services AppServices, logger tasks.Logger, trigger *types.Event) tasks.ActionContext[AppServices] {
	return tasks.ActionContext[AppServices]{
		Services:     services,
		WorkflowID:   "wf-1",
		ExecutionID:  "exec-1",
		TaskID:       "task-1",
		TriggerEvent: trigger,
		Logger:       logger,
	}
}

func TestRecordAlertDispatch_SendsTheAttributionTheRowNeeds(t *testing.T) {
	stub := &stubAlertService{}
	ctx := alertContext(AppServices{alertLog: stub}, &recordingLogger{}, &types.Event{ID: "evt-1"})

	recordAlertDispatch(ctx, "env-1", []byte(`{"id":"env-1"}`))

	if len(stub.created) != 1 {
		t.Fatalf("CreateAlert calls = %d, want 1", len(stub.created))
	}
	got := stub.created[0]
	if got.EnvelopeId != "env-1" {
		t.Errorf("EnvelopeId = %q, want env-1", got.EnvelopeId)
	}
	// The run, not the definition. The field is named for the workflow but
	// documented as the execution that fired the alert, and only the run can
	// answer which dispatch produced a given row.
	if got.WorkflowId != "exec-1" {
		t.Errorf("WorkflowId = %q, want the execution id exec-1", got.WorkflowId)
	}
	if got.SourceEventId != "evt-1" {
		t.Errorf("SourceEventId = %q, want evt-1", got.SourceEventId)
	}
	if got.Payload != `{"id":"env-1"}` {
		t.Errorf("Payload = %q, want the published envelope verbatim", got.Payload)
	}
}

// Manual and scheduled runs have no originating CloudEvent. The column is
// optional precisely for them, so an empty string is correct rather than a
// fabricated id.
func TestRecordAlertDispatch_ManualRunCarriesNoSourceEvent(t *testing.T) {
	stub := &stubAlertService{}
	ctx := alertContext(AppServices{alertLog: stub}, &recordingLogger{}, nil)

	recordAlertDispatch(ctx, "env-1", []byte(`{}`))

	if len(stub.created) != 1 {
		t.Fatalf("CreateAlert calls = %d, want 1", len(stub.created))
	}
	if stub.created[0].SourceEventId != "" {
		t.Errorf("SourceEventId = %q, want empty", stub.created[0].SourceEventId)
	}
}

// The log is best-effort by design: an alert nobody recorded still has to
// play. This pins that a failing log is reported and then let go of.
//
// Asserted here rather than through NewAlertAction, which checks the message
// bus before it records — a nil bus short-circuits ahead of this path, and
// there is no bus fake in this package to reach past it.
func TestRecordAlertDispatch_SurvivesAFailingAlertLog(t *testing.T) {
	logger := &recordingLogger{}
	stub := &stubAlertService{err: fmt.Errorf("db proxy unreachable")}
	ctx := alertContext(AppServices{alertLog: stub}, logger, &types.Event{ID: "evt-1"})

	recordAlertDispatch(ctx, "env-1", []byte(`{}`))

	if len(logger.warns) != 1 {
		t.Errorf("warnings = %d, want the failure reported once rather than swallowed", len(logger.warns))
	}
}

// The engine runs without a db proxy in tests and in a degraded deployment.
// Alerts still fire; this must not panic.
func TestRecordAlertDispatch_NoAlertLogIsNotAFailure(t *testing.T) {
	ctx := alertContext(AppServices{}, &recordingLogger{}, &types.Event{ID: "evt-1"})

	recordAlertDispatch(ctx, "env-1", []byte(`{}`))
}
