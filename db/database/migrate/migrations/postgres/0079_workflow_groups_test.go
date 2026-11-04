package postgres

import (
	"testing"

	"github.com/go-gormigrate/gormigrate/v2"
)

const (
	groupedWorkflowID = "00000000-0000-0000-0000-0000000000f1"
	testGroupID       = "00000000-0000-0000-0000-0000000000a1"
)

func TestWorkflowGroupsLeaveExistingWorkflowsUnheld(t *testing.T) {
	db := openEmptyPostgres(t)
	if err := gormigrate.New(db, gormigrate.DefaultOptions, All()).MigrateTo("0078_workflow_revision"); err != nil {
		t.Fatalf("migrate to 0078: %v", err)
	}
	mustExec(t, db, `INSERT INTO workflow_definitions (id, name, enabled) VALUES (?, 'wf', true)`, groupedWorkflowID)

	if err := gormigrate.New(db, gormigrate.DefaultOptions, All()).MigrateTo("0079_workflow_groups"); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	if n := count(t, db, `SELECT COUNT(*) FROM workflow_definitions
		WHERE id = ? AND enabled AND pre_group_enabled IS NULL`, groupedWorkflowID); n != 1 {
		t.Errorf("existing workflows left enabled and unheld = %d, want 1", n)
	}
}

func TestWorkflowGroupsConstraints(t *testing.T) {
	db := openEmptyPostgres(t)
	if err := gormigrate.New(db, gormigrate.DefaultOptions, All()).MigrateTo("0079_workflow_groups"); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	mustExec(t, db, `INSERT INTO workflow_definitions (id, name) VALUES (?, 'wf')`, groupedWorkflowID)
	mustExec(t, db, `INSERT INTO workflow_groups (id, name) VALUES (?, 'Holiday')`, testGroupID)
	mustExec(t, db, `INSERT INTO workflow_group_members (group_id, workflow_id) VALUES (?, ?)`, testGroupID, groupedWorkflowID)

	if n := count(t, db, `SELECT COUNT(*) FROM workflow_groups WHERE id = ? AND NOT enabled AND description = ''`, testGroupID); n != 1 {
		t.Errorf("new groups off with an empty description = %d, want 1", n)
	}
	refused := []struct {
		name string
		stmt string
		args []any
	}{
		{"a second group with the same name", `INSERT INTO workflow_groups (id, name) VALUES ('00000000-0000-0000-0000-0000000000a2', 'Holiday')`, nil},
		{"the same membership twice", `INSERT INTO workflow_group_members (group_id, workflow_id) VALUES (?, ?)`, []any{testGroupID, groupedWorkflowID}},
		{"a member of no group", `INSERT INTO workflow_group_members (group_id, workflow_id) VALUES ('00000000-0000-0000-0000-0000000000a9', ?)`, []any{groupedWorkflowID}},
	}
	for _, tc := range refused {
		if err := db.Exec(tc.stmt, tc.args...).Error; err == nil {
			t.Errorf("%s was accepted", tc.name)
		}
	}

	mustExec(t, db, `DELETE FROM workflow_definitions WHERE id = ?`, groupedWorkflowID)
	if n := count(t, db, `SELECT COUNT(*) FROM workflow_group_members`); n != 0 {
		t.Errorf("memberships of a deleted workflow = %d, want 0", n)
	}
}

func TestWorkflowGroupsRunTwiceAndRollBack(t *testing.T) {
	db := openEmptyPostgres(t)
	if err := gormigrate.New(db, gormigrate.DefaultOptions, All()).MigrateTo("0079_workflow_groups"); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if err := AddWorkflowGroups().Migrate(db); err != nil {
		t.Fatalf("second run: %v", err)
	}
	if err := gormigrate.New(db, gormigrate.DefaultOptions, All()).RollbackTo("0078_workflow_revision"); err != nil {
		t.Fatalf("rollback: %v", err)
	}
	if n := count(t, db, `SELECT COUNT(*) FROM information_schema.columns
		WHERE table_name = 'workflow_definitions' AND column_name = 'pre_group_enabled'`); n != 0 {
		t.Error("pre_group_enabled survived the rollback")
	}
	if n := count(t, db, `SELECT COUNT(*) FROM information_schema.tables
		WHERE table_name IN ('workflow_groups', 'workflow_group_members')`); n != 0 {
		t.Errorf("%d group tables survived the rollback", n)
	}
}
