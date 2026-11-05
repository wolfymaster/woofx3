package sqlite

import (
	"testing"

	"github.com/go-gormigrate/gormigrate/v2"
)

func TestWorkflowGroupsLeaveExistingWorkflowsUnheld(t *testing.T) {
	db := openMigratedTo(t, "0078_workflow_revision")
	mustExec(t, db, `INSERT INTO workflow_definitions (id, name, enabled) VALUES ('wf1', 'wf', 1)`)

	if err := gormigrate.New(db, gormigrate.DefaultOptions, All()).MigrateTo("0079_workflow_groups"); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	if n := count(t, db, `SELECT COUNT(*) FROM workflow_definitions
		WHERE id = 'wf1' AND enabled = 1 AND pre_group_enabled IS NULL`); n != 1 {
		t.Errorf("existing workflows left enabled and unheld = %d, want 1", n)
	}
}

func TestWorkflowGroupsConstraints(t *testing.T) {
	db := openMigratedTo(t, "0079_workflow_groups")
	mustExec(t, db, `INSERT INTO workflow_definitions (id, name) VALUES ('wf1', 'wf')`)
	mustExec(t, db, `INSERT INTO workflow_groups (id, name) VALUES ('g1', 'Holiday')`)
	mustExec(t, db, `INSERT INTO workflow_group_members (group_id, workflow_id) VALUES ('g1', 'wf1')`)

	if n := count(t, db, `SELECT COUNT(*) FROM workflow_groups WHERE id = 'g1' AND enabled = 0 AND description = ''`); n != 1 {
		t.Errorf("new groups off with an empty description = %d, want 1", n)
	}
	refused := []struct {
		name string
		stmt string
	}{
		{"a second group with the same name", `INSERT INTO workflow_groups (id, name) VALUES ('g2', 'Holiday')`},
		{"the same membership twice", `INSERT INTO workflow_group_members (group_id, workflow_id) VALUES ('g1', 'wf1')`},
		{"a member of no group", `INSERT INTO workflow_group_members (group_id, workflow_id) VALUES ('g9', 'wf1')`},
	}
	for _, tc := range refused {
		if err := db.Exec(tc.stmt).Error; err == nil {
			t.Errorf("%s was accepted", tc.name)
		}
	}

	mustExec(t, db, `DELETE FROM workflow_definitions WHERE id = 'wf1'`)
	if n := count(t, db, `SELECT COUNT(*) FROM workflow_group_members`); n != 0 {
		t.Errorf("memberships of a deleted workflow = %d, want 0", n)
	}
}

func TestWorkflowGroupsRunTwiceAndRollBack(t *testing.T) {
	db := openMigratedTo(t, "0079_workflow_groups")
	if err := AddWorkflowGroups().Migrate(db); err != nil {
		t.Fatalf("second run: %v", err)
	}
	if err := gormigrate.New(db, gormigrate.DefaultOptions, All()).RollbackTo("0078_workflow_revision"); err != nil {
		t.Fatalf("rollback: %v", err)
	}
	if n := count(t, db, `SELECT COUNT(*) FROM pragma_table_info('workflow_definitions') WHERE name = 'pre_group_enabled'`); n != 0 {
		t.Error("pre_group_enabled survived the rollback")
	}
	if n := count(t, db, `SELECT COUNT(*) FROM sqlite_master
		WHERE type = 'table' AND name IN ('workflow_groups', 'workflow_group_members')`); n != 0 {
		t.Errorf("%d group tables survived the rollback", n)
	}
}
