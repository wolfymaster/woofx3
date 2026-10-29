package sqlite

import (
	"strings"
	"testing"
)

func TestResourceKindCustomModuleIsAdmittedAndRowsSurvive(t *testing.T) {
	db := openMigratedTo(t, "0071_workflow_datetime_columns")
	mustExec(t, db, `INSERT INTO resources (id, is_folder, name, kind, status) VALUES ('f1', 1, 'clips', 'folder', 'ready')`)
	mustExec(t, db, `INSERT INTO resources (id, parent_id, name, kind, repository_key) VALUES ('r1', 'f1', 'a.png', 'image', 'user/r1/a.png')`)
	if err := db.Exec(`INSERT INTO resources (id, name, kind, repository_key) VALUES ('m0', 'm.zip', 'custom_module', 'user/m0/m.zip')`).Error; err == nil {
		t.Fatal("kind custom_module was accepted before 0072")
	}

	if err := migrateAll(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	mustExec(t, db, `INSERT INTO resources (id, name, kind, repository_key) VALUES ('m1', 'm.zip', 'custom_module', 'user/m1/m.zip')`)
	if err := db.Exec(`INSERT INTO resources (id, name, kind, repository_key) VALUES ('x1', 'x', 'sticker', 'user/x1/x')`).Error; err == nil {
		t.Error("an unknown kind was accepted after 0072")
	}
	if got := count(t, db, `SELECT COUNT(*) FROM resources WHERE parent_id = 'f1'`); got != 1 {
		t.Errorf("children of the folder = %d, want the original 1", got)
	}
	// The self-reference still cascades after the rebuild.
	mustExec(t, db, `DELETE FROM resources WHERE id = 'f1'`)
	if got := count(t, db, `SELECT COUNT(*) FROM resources WHERE id = 'r1'`); got != 0 {
		t.Errorf("child rows after deleting their folder = %d, want 0", got)
	}

	var createSQL string
	if err := db.Raw(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'resources'`).Row().Scan(&createSQL); err != nil {
		t.Fatalf("read definition: %v", err)
	}
	for _, kept := range []string{"resources_status_check", "resources_folder_has_no_bytes"} {
		if !strings.Contains(createSQL, kept) {
			t.Errorf("rebuilt resources lost constraint %s: %s", kept, createSQL)
		}
	}
}

func TestResourceKindCustomModuleRerunIsANoOp(t *testing.T) {
	db := openMigratedTo(t, "0072_resource_kind_custom_module")
	before := count(t, db, `SELECT COUNT(*) FROM sqlite_master`)

	if err := AllowCustomModuleResourceKind().Migrate(db); err != nil {
		t.Fatalf("rerun: %v", err)
	}
	if after := count(t, db, `SELECT COUNT(*) FROM sqlite_master`); after != before {
		t.Errorf("schema objects = %d after a rerun, want %d", after, before)
	}
}
