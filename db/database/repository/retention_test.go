package repository

import (
	"fmt"
	"sort"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
)

func TestPruneSettledAlertsKeepsUnsettledAndRecentOnes(t *testing.T) {
	db := openFactDb(t)
	alerts := NewAlertRepository(db)
	cutoff := time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC)
	old := cutoff.Add(-time.Hour)
	recent := cutoff.Add(time.Hour)

	seed := func(name, status string, createdAt time.Time) {
		t.Helper()
		row, err := alerts.Create(NewAlert{ID: uuid.New(), Payload: `{}`, EnvelopeID: name},
			func(*gorm.DB, *models.Alert) error { return nil })
		if err != nil {
			t.Fatalf("Create: %v", err)
		}
		if err := db.Exec(`UPDATE alerts SET status = ?, created_at = ? WHERE id = ?`,
			status, createdAt.Format(database.SQLiteTimestampLayout), row.ID).Error; err != nil {
			t.Fatalf("age alert: %v", err)
		}
	}
	for _, status := range []string{
		AlertStatusCompleted, AlertStatusFailed, AlertStatusTimedOut, AlertStatusSkipped, AlertStatusReplayed,
	} {
		seed("old-"+status, status, old)
		seed("recent-"+status, status, recent)
	}
	// Still queued or on screen, however old.
	for _, status := range []string{AlertStatusSent, AlertStatusDispatched, AlertStatusPlaying, "pending"} {
		seed("old-"+status, status, old)
	}

	pruned, err := alerts.PruneSettled(cutoff, 2)
	if err != nil {
		t.Fatalf("PruneSettled: %v", err)
	}
	if pruned != 5 {
		t.Fatalf("pruned %d alerts, want the 5 old settled ones", pruned)
	}
	var left []string
	if err := db.Model(&models.Alert{}).Pluck("envelope_id", &left).Error; err != nil {
		t.Fatalf("list: %v", err)
	}
	sort.Strings(left)
	want := []string{
		"old-dispatched", "old-pending", "old-playing", "old-sent",
		"recent-completed", "recent-failed", "recent-replayed", "recent-skipped", "recent-timed_out",
	}
	if fmt.Sprint(left) != fmt.Sprint(want) {
		t.Fatalf("left %v, want %v", left, want)
	}
}

func TestPruneSettledRunsKeepsRunningAndRecentRunsAndDropsSteps(t *testing.T) {
	db := openFactDb(t)
	// The runs reference workflow definitions this test has no use for; the
	// steps' cascade is not relied on, which is what this checks.
	if err := db.Exec(`PRAGMA foreign_keys = OFF`).Error; err != nil {
		t.Fatalf("disable foreign keys: %v", err)
	}
	runs := NewWorkflowRepository(db, database.RandomIDs{})
	cutoff := time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC)
	old := cutoff.Add(-time.Hour)
	recent := cutoff.Add(time.Hour)

	seed := func(name, status string, completedAt *time.Time, updatedAt time.Time) {
		t.Helper()
		id := uuid.New()
		if err := db.Exec(`INSERT INTO workflow_executions (id, workflow_id, status, error, completed_at, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)`, id, uuid.New(), status, name, completedAt, old.Add(-time.Hour), updatedAt).Error; err != nil {
			t.Fatalf("insert run: %v", err)
		}
		if err := db.Exec(`INSERT INTO workflow_execution_steps (id, execution_id, task_id, status, step_index)
			VALUES (?, ?, 'task', 'completed', 0)`, uuid.New(), id).Error; err != nil {
			t.Fatalf("insert step: %v", err)
		}
	}
	for _, status := range models.TerminalWorkflowStatuses() {
		seed("old-"+string(status), string(status), &old, recent)
		seed("recent-"+string(status), string(status), &recent, recent)
	}
	// A settled run without a completion time is aged by its last update.
	seed("old-unstamped", string(models.WorkflowStatusFailed), nil, old)
	seed("old-running", string(models.WorkflowStatusRunning), nil, old)
	seed("old-pending", string(models.WorkflowStatusPending), nil, old)

	pruned, err := runs.PruneSettledRuns(cutoff, 2)
	if err != nil {
		t.Fatalf("PruneSettledRuns: %v", err)
	}
	if pruned != 4 {
		t.Fatalf("pruned %d runs, want the 4 old settled ones", pruned)
	}
	var left []string
	if err := db.Model(&models.WorkflowExecution{}).Pluck("error", &left).Error; err != nil {
		t.Fatalf("list: %v", err)
	}
	sort.Strings(left)
	want := []string{"old-pending", "old-running", "recent-cancelled", "recent-completed", "recent-failed"}
	if fmt.Sprint(left) != fmt.Sprint(want) {
		t.Fatalf("left %v, want %v", left, want)
	}
	var orphans int64
	if err := db.Raw(`SELECT COUNT(*) FROM workflow_execution_steps s
		WHERE NOT EXISTS (SELECT 1 FROM workflow_executions e WHERE e.id = s.execution_id)`).Scan(&orphans).Error; err != nil {
		t.Fatalf("count orphans: %v", err)
	}
	if orphans != 0 {
		t.Fatalf("%d steps outlived their runs", orphans)
	}
}
