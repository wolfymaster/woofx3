package services

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/database"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
	"gorm.io/gorm"
)

func closeDB(t *testing.T, db *gorm.DB) {
	t.Helper()
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("sql db: %v", err)
	}
	if err := sqlDB.Close(); err != nil {
		t.Fatalf("close db: %v", err)
	}
}

func TestGetWorkflowExecution_MissingRunIsNotFound(t *testing.T) {
	svc, _ := newRunStatusSvc(t)

	_, err := svc.GetWorkflowExecution(context.Background(), &client.GetWorkflowExecutionRequest{Id: uuid.NewString()})

	if code := twirpCode(err); code != twirp.NotFound {
		t.Fatalf("code = %s, want not_found", code)
	}
}

// A dead database must not read as "no such run": callers turn NotFound into
// an absent run, which hides the outage.
func TestGetWorkflowExecution_FailedReadIsInternal(t *testing.T) {
	svc, db := newRunStatusSvc(t)
	id := recordRun(t, svc)
	closeDB(t, db)

	_, err := svc.GetWorkflowExecution(context.Background(), &client.GetWorkflowExecutionRequest{Id: id})

	if code := twirpCode(err); code != twirp.Internal {
		t.Fatalf("code = %s, want internal", code)
	}
}

func TestUpdateWorkflowRunStatus_FailedReadIsInternal(t *testing.T) {
	svc, db := newRunStatusSvc(t)
	id := recordRun(t, svc)
	closeDB(t, db)

	_, err := setRunStatus(svc, id, "completed", "")

	if code := twirpCode(err); code != twirp.Internal {
		t.Fatalf("code = %s, want internal", code)
	}
}

func TestGetWorkflow_FailedReadIsInternal(t *testing.T) {
	db := newTestDB(t)
	svc := NewWorkflowService(repo.NewWorkflowRepository(db, database.RandomIDs{}), nil, db, nil, nil)
	closeDB(t, db)

	_, err := svc.GetWorkflow(context.Background(), &client.GetWorkflowRequest{Id: uuid.NewString()})

	if code := twirpCode(err); code != twirp.Internal {
		t.Fatalf("code = %s, want internal", code)
	}
}

// A run whose steps cannot be read is an error, not a run with no steps.
func TestGetWorkflowExecution_UnreadableStepsIsInternal(t *testing.T) {
	svc, db := newRunStatusSvc(t)
	id := recordRun(t, svc)
	if err := db.Exec(`DROP TABLE workflow_execution_steps`).Error; err != nil {
		t.Fatalf("drop steps table: %v", err)
	}

	_, err := svc.GetWorkflowExecution(context.Background(), &client.GetWorkflowExecutionRequest{Id: id})

	if code := twirpCode(err); code != twirp.Internal {
		t.Fatalf("code = %s, want internal", code)
	}
}
