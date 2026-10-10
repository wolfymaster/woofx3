package sqlite

import (
	"testing"

	"github.com/go-gormigrate/gormigrate/v2"
)

// A scene saved before the column existed loads with no editor state, and
// rolling back drops only the column.
func TestAddSceneEditorStateKeepsExistingScenesAndRollsBack(t *testing.T) {
	db := openMigratedTo(t, "0055_alert_timestamps_utc")
	const scene = "00000000-0000-0000-0000-0000000000a1"
	mustExec(t, db, `INSERT INTO scenes (id, name, widgets_json) VALUES (?, 'Main', '[{"id":"a"}]')`, scene)

	migrator := gormigrate.New(db, gormigrate.DefaultOptions, All())
	if err := migrator.MigrateTo("0056_scene_editor_state"); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if n := count(t, db, `SELECT COUNT(*) FROM scenes WHERE id = ? AND editor_state_json IS NULL`, scene); n != 1 {
		t.Fatalf("existing scene has editor state after the migration")
	}
	mustExec(t, db, `UPDATE scenes SET editor_state_json = '{"v":3}' WHERE id = ?`, scene)

	if err := migrator.RollbackLast(); err != nil {
		t.Fatalf("rollback: %v", err)
	}
	exists, err := columnExists(db, "scenes", "editor_state_json")
	if err != nil {
		t.Fatalf("inspect scenes: %v", err)
	}
	if exists {
		t.Fatalf("editor_state_json survived the rollback")
	}
	if n := count(t, db, `SELECT COUNT(*) FROM scenes WHERE id = ? AND widgets_json = '[{"id":"a"}]'`, scene); n != 1 {
		t.Fatalf("rollback lost the scene")
	}
}
