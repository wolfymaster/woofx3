package postgres

import (
	"testing"

	"github.com/go-gormigrate/gormigrate/v2"
)

func TestFractionWidgetOpacityRewritesEveryStoredPlacement(t *testing.T) {
	db := openEmptyPostgres(t)
	if err := gormigrate.New(db, gormigrate.DefaultOptions, All()).MigrateTo("0052_scene_drafts"); err != nil {
		t.Fatalf("migrate to 0052: %v", err)
	}
	const scene = "00000000-0000-0000-0000-0000000000a1"
	const fresh = "00000000-0000-0000-0000-0000000000a2"
	const workflow = "00000000-0000-0000-0000-0000000000b1"
	const command = "00000000-0000-0000-0000-0000000000c1"
	const alert = "00000000-0000-0000-0000-0000000000d1"
	layout := `{"layout": {"width": 800, "height": 600, "widgets": [{"id": "w", "opacity": 100}]}}`
	mustExec(t, db, `INSERT INTO scenes (id, name, widgets_json, draft_widgets_json) VALUES (?, 'Main', ?::jsonb, ?::jsonb)`,
		scene, `[{"id": "a", "opacity": 100}, {"id": "b"}]`, `[{"id": "a", "opacity": 40}]`)
	mustExec(t, db, `INSERT INTO scenes (id, name, widgets_json) VALUES (?, 'Fresh', ?::jsonb)`,
		fresh, `[{"id": "a", "opacity": 0.5}]`)
	mustExec(t, db, `INSERT INTO workflow_definitions (id, name, steps) VALUES (?, 'wf', ?::jsonb)`,
		workflow, `[{"id": "s", "type": "action", "action": "alert", "parameters": `+layout+`}]`)
	mustExec(t, db, `INSERT INTO commands (id, command, actions) VALUES (?, 'hype', ?::jsonb)`,
		command, `[{"id": "action-1", "action": "alert", "parameters": `+layout+`}]`)
	mustExec(t, db, `INSERT INTO alerts (id, payload) VALUES (?, ?::jsonb)`,
		alert, `{"id": "e1", "parameters": `+layout+`, "event": null}`)

	if err := gormigrate.New(db, gormigrate.DefaultOptions, All()).Migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	checks := []struct {
		name  string
		query string
	}{
		{"scene", `SELECT COUNT(*) FROM scenes WHERE id = ? AND (widgets_json->0->>'opacity')::float = 1
			AND widgets_json->1->>'opacity' IS NULL`},
		{"scene draft", `SELECT COUNT(*) FROM scenes WHERE id = ? AND (draft_widgets_json->0->>'opacity')::float = 0.4`},
		{"fraction scene", `SELECT COUNT(*) FROM scenes WHERE id = ? AND (widgets_json->0->>'opacity')::float = 0.5
			AND draft_widgets_json IS NULL`},
		{"workflow step", `SELECT COUNT(*) FROM workflow_definitions
			WHERE id = ? AND (steps->0->'parameters'->'layout'->'widgets'->0->>'opacity')::float = 1`},
		{"command action", `SELECT COUNT(*) FROM commands
			WHERE id = ? AND (actions->0->'parameters'->'layout'->'widgets'->0->>'opacity')::float = 1`},
		{"alert", `SELECT COUNT(*) FROM alerts
			WHERE id = ? AND (payload->'parameters'->'layout'->'widgets'->0->>'opacity')::float = 1`},
	}
	ids := []string{scene, scene, fresh, workflow, command, alert}
	for i, check := range checks {
		if n := count(t, db, check.query, ids[i]); n != 1 {
			t.Errorf("%s: not rewritten as expected", check.name)
		}
	}
}
