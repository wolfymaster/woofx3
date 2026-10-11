package sqlite

import "testing"

// A widget registered before the column existed reads as declaring nothing.
func TestAddWidgetBehaviorsDefaultsToDeclaringNothing(t *testing.T) {
	db := openMigratedTo(t, "0059_widget_behaviors")
	mustExec(t, db, `INSERT INTO widgets (id, name, directory, manifest_id) VALUES ('00000000-0000-0000-0000-0000000000a1', 'Image', 'widgets/image', 'image')`)
	var kinds string
	if err := db.Raw(`SELECT behavior_kinds FROM widgets WHERE manifest_id = 'image'`).Scan(&kinds).Error; err != nil {
		t.Fatalf("read behavior_kinds: %v", err)
	}
	if want := `{"transitions":[],"effects":[]}`; kinds != want {
		t.Fatalf("behavior_kinds = %q, want %q", kinds, want)
	}
}
