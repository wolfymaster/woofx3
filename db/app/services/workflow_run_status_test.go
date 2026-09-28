package services

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/database/models"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

func newRunStatusSvc(t *testing.T) (client.WorkflowService, *gorm.DB) {
	t.Helper()
	db := newTestDB(t)
	if err := db.Exec(`CREATE TABLE workflow_executions (
		id TEXT PRIMARY KEY,
		workflow_id TEXT NOT NULL,
		user_id TEXT,
		status VARCHAR(20) NOT NULL DEFAULT 'pending',
		input TEXT,
		output TEXT,
		error TEXT,
		trigger_event TEXT,
		triggered_by TEXT,
		dry_run BOOLEAN NOT NULL DEFAULT 0,
		started_at DATETIME,
		completed_at DATETIME,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`).Error; err != nil {
		t.Fatalf("create workflow_executions: %v", err)
	}
	return NewWorkflowService(nil, db, nil, nil), db
}

func recordRun(t *testing.T, svc client.WorkflowService) string {
	t.Helper()
	id := uuid.New().String()
	if _, err := svc.RecordWorkflowRun(context.Background(), &client.RecordWorkflowRunRequest{
		Id:          id,
		WorkflowId:  uuid.New().String(),
		TriggeredBy: "test",
		StartedAt:   timestamppb.Now(),
	}); err != nil {
		t.Fatalf("RecordWorkflowRun: %v", err)
	}
	return id
}

func setRunStatus(svc client.WorkflowService, id, status, errMsg string) (*client.WorkflowExecutionResponse, error) {
	return svc.UpdateWorkflowRunStatus(context.Background(), &client.UpdateWorkflowRunStatusRequest{
		Id:          id,
		Status:      status,
		Error:       errMsg,
		CompletedAt: timestamppb.New(time.Now()),
	})
}

func storedStatus(t *testing.T, db *gorm.DB, id string) models.WorkflowExecutionStatus {
	t.Helper()
	exec, err := models.GetWorkflowExecutionByID(db, uuid.MustParse(id))
	if err != nil {
		t.Fatalf("reload run: %v", err)
	}
	return exec.Status
}

func TestUpdateWorkflowRunStatus_SettlesARunningRun(t *testing.T) {
	svc, db := newRunStatusSvc(t)
	id := recordRun(t, svc)

	resp, err := setRunStatus(svc, id, "completed", "")
	if err != nil {
		t.Fatalf("UpdateWorkflowRunStatus: %v", err)
	}
	if resp.Execution.Status != "completed" || resp.Execution.CompletedAt == nil {
		t.Errorf("execution = %+v", resp.Execution)
	}
	if got := storedStatus(t, db, id); got != models.WorkflowStatusCompleted {
		t.Errorf("stored status = %q", got)
	}
}

// The case the guard exists for: a run cancelled by hand whose last step
// finishes afterwards must stay cancelled.
func TestUpdateWorkflowRunStatus_ACancelledRunStaysCancelled(t *testing.T) {
	svc, db := newRunStatusSvc(t)
	id := recordRun(t, svc)
	if _, err := setRunStatus(svc, id, "cancelled", "cancelled: by hand"); err != nil {
		t.Fatalf("cancel: %v", err)
	}

	_, err := setRunStatus(svc, id, "completed", "")
	if twerr, ok := err.(twirp.Error); !ok || twerr.Code() != twirp.FailedPrecondition {
		t.Fatalf("err = %v, want FailedPrecondition", err)
	}
	if got := storedStatus(t, db, id); got != models.WorkflowStatusCancelled {
		t.Errorf("stored status = %q, want cancelled", got)
	}
}

func TestUpdateWorkflowRunStatus_RefusesLeavingAnyTerminalStatus(t *testing.T) {
	for _, terminal := range []string{"completed", "failed", "cancelled"} {
		t.Run(terminal, func(t *testing.T) {
			svc, db := newRunStatusSvc(t)
			id := recordRun(t, svc)
			if _, err := setRunStatus(svc, id, terminal, ""); err != nil {
				t.Fatalf("settle: %v", err)
			}
			if _, err := setRunStatus(svc, id, "running", ""); err == nil {
				t.Fatal("a settled run was moved back to running")
			}
			if got := storedStatus(t, db, id); string(got) != terminal {
				t.Errorf("stored status = %q, want %q", got, terminal)
			}
		})
	}
}

// Delivery is at-least-once, so the same report twice is not an error.
func TestUpdateWorkflowRunStatus_RepeatingTheSameStatusIsANoOp(t *testing.T) {
	svc, _ := newRunStatusSvc(t)
	id := recordRun(t, svc)
	if _, err := setRunStatus(svc, id, "failed", "boom"); err != nil {
		t.Fatalf("settle: %v", err)
	}
	resp, err := setRunStatus(svc, id, "failed", "boom again")
	if err != nil {
		t.Fatalf("repeat: %v", err)
	}
	if resp.Execution.Error != "boom" {
		t.Errorf("error = %q, want the first report kept", resp.Execution.Error)
	}
}

func TestUpdateWorkflowRunStatus_UnknownRun(t *testing.T) {
	svc, _ := newRunStatusSvc(t)
	_, err := setRunStatus(svc, uuid.New().String(), "cancelled", "")
	if twerr, ok := err.(twirp.Error); !ok || twerr.Code() != twirp.NotFound {
		t.Fatalf("err = %v, want NotFound", err)
	}
}

func TestRecordWorkflowRun_KeepsTheDryRunMark(t *testing.T) {
	svc, db := newRunStatusSvc(t)
	id := uuid.New().String()
	resp, err := svc.RecordWorkflowRun(context.Background(), &client.RecordWorkflowRunRequest{
		Id:          id,
		WorkflowId:  uuid.New().String(),
		TriggeredBy: "test",
		DryRun:      true,
	})
	if err != nil {
		t.Fatalf("RecordWorkflowRun: %v", err)
	}
	if !resp.Execution.DryRun {
		t.Error("response lost the dry-run mark")
	}
	exec, err := models.GetWorkflowExecutionByID(db, uuid.MustParse(id))
	if err != nil {
		t.Fatalf("reload run: %v", err)
	}
	if !exec.DryRun {
		t.Error("stored run lost the dry-run mark")
	}
}
