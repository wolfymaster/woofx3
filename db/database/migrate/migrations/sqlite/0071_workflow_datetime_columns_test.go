package sqlite

import (
	"testing"
	"time"
)

func TestWorkflowDatetimeColumnsKeepWorkflowsReadable(t *testing.T) {
	db := openMigratedTo(t, "0069_revoke_ungranted_command_wildcards")
	// One value in SQLite's own datetime('now') shape, one in the shape the
	// driver writes a time.Time in.
	mustExec(t, db, `INSERT INTO workflow_definitions (id, name, created_by_type, created_by_ref, manifest_id, created_at, updated_at)
		VALUES ('00000000-0000-0000-0000-00000000f101', 'follow', 'MODULE', 'twitch_platform', 'follow-workflow',
			'2026-09-27 20:00:00', '2026-09-27 23:30:00.5-05:00')`)
	mustExec(t, db, `INSERT INTO workflow_executions (id, workflow_id) VALUES ('we1', '00000000-0000-0000-0000-00000000f101')`)

	if err := migrateAll(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	var workflows []struct {
		CreatedAt time.Time
		UpdatedAt time.Time
	}
	if err := db.Raw(`SELECT created_at, updated_at FROM workflow_definitions`).Scan(&workflows).Error; err != nil {
		t.Fatalf("read workflow_definitions: %v", err)
	}
	if len(workflows) != 1 {
		t.Fatalf("workflow_definitions rows = %d, want the original 1", len(workflows))
	}
	if want := time.Date(2026, 9, 27, 20, 0, 0, 0, time.UTC); !workflows[0].CreatedAt.Equal(want) {
		t.Errorf("created_at = %v, want %v", workflows[0].CreatedAt, want)
	}
	if want := time.Date(2026, 9, 28, 4, 30, 0, 500_000_000, time.UTC); !workflows[0].UpdatedAt.Equal(want) {
		t.Errorf("updated_at = %v, want %v", workflows[0].UpdatedAt, want)
	}
	if got := count(t, db, `SELECT COUNT(*) FROM workflow_executions`); got != 1 {
		t.Errorf("workflow_executions rows = %d, want the original 1", got)
	}

	// A module's workflow stays unique per manifest id across the rebuild,
	// and the index stays partial, so USER workflows with no manifest id
	// still coexist.
	if err := db.Exec(`INSERT INTO workflow_definitions (id, name, created_by_type, created_by_ref, manifest_id)
		VALUES ('00000000-0000-0000-0000-00000000f102', 'follow again', 'MODULE', 'twitch_platform', 'follow-workflow')`).Error; err == nil {
		t.Error("a second workflow for one module manifest id was accepted")
	}
	mustExec(t, db, `INSERT INTO workflow_definitions (id, name) VALUES ('00000000-0000-0000-0000-00000000f103', 'mine')`)
	mustExec(t, db, `INSERT INTO workflow_definitions (id, name) VALUES ('00000000-0000-0000-0000-00000000f104', 'also mine')`)

	mustExec(t, db, `DELETE FROM workflow_definitions WHERE id = '00000000-0000-0000-0000-00000000f101'`)
	if got := count(t, db, `SELECT COUNT(*) FROM workflow_executions`); got != 0 {
		t.Errorf("executions after deleting their workflow = %d, want 0", got)
	}
}

func TestWorkflowDatetimeColumnsRerunIsANoOp(t *testing.T) {
	db := openMigratedTo(t, "0071_workflow_datetime_columns")
	before := count(t, db, `SELECT COUNT(*) FROM sqlite_master`)

	if err := DeclareWorkflowDatetimeColumns().Migrate(db); err != nil {
		t.Fatalf("rerun: %v", err)
	}
	if after := count(t, db, `SELECT COUNT(*) FROM sqlite_master`); after != before {
		t.Errorf("schema objects = %d after a rerun, want %d", after, before)
	}
}
