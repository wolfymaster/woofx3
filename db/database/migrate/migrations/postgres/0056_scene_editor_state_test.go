package postgres

import (
	"testing"

	"github.com/go-gormigrate/gormigrate/v2"
)

// A scene saved before the column existed loads with no editor state, and
// rolling back drops only the column.
func TestAddSceneEditorStateKeepsExistingScenesAndRollsBack(t *testing.T) {
	db := openEmptyPostgres(t)
	migrator := gormigrate.New(db, gormigrate.DefaultOptions, All())
	if err := migrator.MigrateTo("0055_alert_timestamps_utc"); err != nil {
		t.Fatalf("migrate to 0055: %v", err)
	}
	const scene = "00000000-0000-0000-0000-0000000000a1"
	mustExec(t, db, `INSERT INTO scenes (id, name, widgets_json) VALUES (?, 'Main', ?::jsonb)`, scene, `[{"id": "a"}]`)

	if err := migrator.MigrateTo("0056_scene_editor_state"); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if n := count(t, db, `SELECT COUNT(*) FROM scenes WHERE id = ? AND editor_state_json IS NULL`, scene); n != 1 {
		t.Fatalf("existing scene has editor state after the migration")
	}
	const state = `{"v": 3,  "headId":"e.3"}`
	mustExec(t, db, `UPDATE scenes SET editor_state_json = ? WHERE id = ?`, state, scene)
	var stored string
	if err := db.Raw(`SELECT editor_state_json FROM scenes WHERE id = ?`, scene).Scan(&stored).Error; err != nil {
		t.Fatalf("read editor state: %v", err)
	}
	if stored != state {
		t.Fatalf("editor state stored as %q, want it byte for byte: %q", stored, state)
	}

	if err := migrator.RollbackLast(); err != nil {
		t.Fatalf("rollback: %v", err)
	}
	exists, err := columnExists(db, "public", "scenes", "editor_state_json")
	if err != nil {
		t.Fatalf("inspect scenes: %v", err)
	}
	if exists {
		t.Fatalf("editor_state_json survived the rollback")
	}
	if n := count(t, db, `SELECT COUNT(*) FROM scenes WHERE id = ? AND widgets_json->0->>'id' = 'a'`, scene); n != 1 {
		t.Fatalf("rollback lost the scene")
	}
}
