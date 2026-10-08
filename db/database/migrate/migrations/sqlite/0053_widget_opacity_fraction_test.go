package sqlite

import (
	"encoding/json"
	"testing"
)

func TestFractionWidgetOpacityRewritesEveryStoredPlacement(t *testing.T) {
	db := openMigratedTo(t, "0052_scene_drafts")
	mustExec(t, db, `INSERT INTO scenes (id, name, widgets_json, draft_widgets_json) VALUES (?, 'Main', ?, ?)`,
		"s1", `[{"id": "a", "opacity": 100}, {"id": "b"}]`, `[{"id": "a", "opacity": 40}]`)
	mustExec(t, db, `INSERT INTO scenes (id, name, widgets_json) VALUES (?, 'Fresh', ?)`,
		"s2", `[{"id": "a", "opacity": 0.5}]`)
	layout := `{"layout": {"width": 800, "height": 600, "widgets": [{"id": "w", "opacity": 100}]}}`
	mustExec(t, db, `INSERT INTO workflow_definitions (id, name, steps) VALUES (?, 'wf', ?)`,
		"wd1", `[{"id": "s", "type": "action", "action": "alert", "parameters": `+layout+`}]`)
	mustExec(t, db, `INSERT INTO workflow_definitions (id, name) VALUES (?, 'empty')`, "wd2")
	mustExec(t, db, `INSERT INTO commands (id, command, actions) VALUES (?, 'hype', ?)`,
		"c1", `[{"id": "action-1", "action": "alert", "parameters": `+layout+`}]`)
	mustExec(t, db, `INSERT INTO alerts (id, payload) VALUES (?, ?)`,
		"al1", `{"id": "e1", "parameters": `+layout+`, "event": null}`)

	if err := migrateAll(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	opacityAt := func(query string, path func(any) any) any {
		t.Helper()
		var text string
		if err := db.Raw(query).Scan(&text).Error; err != nil {
			t.Fatalf("%s: %v", query, err)
		}
		var value any
		if err := json.Unmarshal([]byte(text), &value); err != nil {
			t.Fatalf("%s: stored JSON does not parse: %v", query, err)
		}
		return path(value)
	}
	placement := func(i int) func(any) any {
		return func(v any) any { return v.([]any)[i].(map[string]any)["opacity"] }
	}
	layoutWidget := func(v any) any {
		params := v.(map[string]any)["parameters"].(map[string]any)
		widgets := params["layout"].(map[string]any)["widgets"].([]any)
		return widgets[0].(map[string]any)["opacity"]
	}
	firstStep := func(v any) any { return layoutWidget(v.([]any)[0]) }

	checks := []struct {
		name  string
		query string
		path  func(any) any
		want  any
	}{
		{"scene", `SELECT widgets_json FROM scenes WHERE id = 's1'`, placement(0), float64(1)},
		{"scene without opacity", `SELECT widgets_json FROM scenes WHERE id = 's1'`, placement(1), nil},
		{"scene draft", `SELECT draft_widgets_json FROM scenes WHERE id = 's1'`, placement(0), 0.4},
		{"fraction scene", `SELECT widgets_json FROM scenes WHERE id = 's2'`, placement(0), 0.5},
		{"workflow step", `SELECT steps FROM workflow_definitions WHERE id = 'wd1'`, firstStep, float64(1)},
		{"command action", `SELECT actions FROM commands WHERE id = 'c1'`, firstStep, float64(1)},
		{"alert", `SELECT payload FROM alerts WHERE id = 'al1'`, layoutWidget, float64(1)},
	}
	for _, check := range checks {
		if got := opacityAt(check.query, check.path); got != check.want {
			t.Errorf("%s: opacity %v, want %v", check.name, got, check.want)
		}
	}
	if n := count(t, db, `SELECT COUNT(*) FROM workflow_definitions WHERE id = 'wd2' AND steps IS NULL`); n != 1 {
		t.Error("a workflow with no steps was given some")
	}
	if n := count(t, db, `SELECT COUNT(*) FROM scenes WHERE id = 's2' AND draft_widgets_json IS NULL`); n != 1 {
		t.Error("a scene with no draft was given one")
	}
}
