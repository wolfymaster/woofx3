package sqlite

import (
	"testing"

	"github.com/go-gormigrate/gormigrate/v2"
)

// Existing rows become scenes with no behaviors or inputs, names are unique
// per kind, an unknown kind is refused, and rolling back removes the alerts
// with the columns.
func TestAddSceneCompositionsKeepsScenesAndScopesNamesByKind(t *testing.T) {
	db := openMigratedTo(t, "0056_scene_editor_state")
	const scene = "00000000-0000-0000-0000-0000000000c1"
	const alert = "00000000-0000-0000-0000-0000000000c2"
	mustExec(t, db, `INSERT INTO scenes (id, name, widgets_json, draft_widgets_json, draft_layout_json)
		VALUES (?, 'Main', '[{"id":"a"}]', '[]', '{}')`, scene)

	migrator := gormigrate.New(db, gormigrate.DefaultOptions, All())
	if err := migrator.MigrateTo("0060_scene_compositions"); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if n := count(t, db, `SELECT COUNT(*) FROM scenes WHERE id = ? AND kind = 'scene'
		AND behaviors_json = '{}' AND inputs_json = '[]' AND draft_behaviors_json IS NULL`, scene); n != 1 {
		t.Fatalf("the existing scene did not become a scene with no behaviors or inputs")
	}

	mustExec(t, db, `INSERT INTO scenes (id, name, kind) VALUES (?, 'Main', 'alert')`, alert)
	if err := db.Exec(`INSERT INTO scenes (id, name, kind) VALUES ('00000000-0000-0000-0000-0000000000c3', 'Main', 'alert')`).Error; err == nil {
		t.Fatalf("two alerts share a name")
	}
	if err := db.Exec(`INSERT INTO scenes (id, name, kind) VALUES ('00000000-0000-0000-0000-0000000000c4', 'Other', 'widget')`).Error; err == nil {
		t.Fatalf("a row of an unknown kind was stored")
	}

	if err := migrator.RollbackLast(); err != nil {
		t.Fatalf("rollback: %v", err)
	}
	for _, column := range []string{"kind", "behaviors_json", "draft_behaviors_json", "inputs_json"} {
		exists, err := columnExists(db, "scenes", column)
		if err != nil {
			t.Fatalf("inspect scenes: %v", err)
		}
		if exists {
			t.Fatalf("%s survived the rollback", column)
		}
	}
	if n := count(t, db, `SELECT COUNT(*) FROM scenes`); n != 1 {
		t.Fatalf("rollback left %d rows, want the scene alone", n)
	}
	if err := db.Exec(`INSERT INTO scenes (id, name) VALUES ('00000000-0000-0000-0000-0000000000c5', 'Main')`).Error; err == nil {
		t.Fatalf("names are not unique again after the rollback")
	}
}
