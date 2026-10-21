package sqlite

import (
	"testing"

	"github.com/go-gormigrate/gormigrate/v2"
)

func TestLocalUISettingsStartTheCounterAtZero(t *testing.T) {
	db := openMigratedTo(t, "0068_local_ui_settings")

	if n := count(t, db, `SELECT revision FROM local_ui_settings_revision WHERE id = 1`); n != 0 {
		t.Fatalf("seeded revision = %d, want 0", n)
	}
	if err := db.Exec(`INSERT INTO local_ui_settings_revision (id, revision) VALUES (2, 0)`).Error; err == nil {
		t.Error("a second counter row was accepted")
	}
}

func TestLocalUISettingsKeepOneRowPerKeyAndRevision(t *testing.T) {
	db := openMigratedTo(t, "0068_local_ui_settings")
	insert := `INSERT INTO local_ui_settings (namespace, key, value, revision, deleted) VALUES (?, ?, ?, ?, ?)`

	mustExec(t, db, insert, "macros", "m1", `{"steps":[]}`, 1, false)
	mustExec(t, db, insert, "dashboardNotes", "m1", `"note"`, 2, false)
	mustExec(t, db, insert, "macros", "m2", nil, 3, true)

	refused := []struct {
		name string
		args []any
	}{
		{"a second row for one key", []any{"macros", "m1", `1`, 4, false}},
		{"a revision already taken", []any{"macros", "m3", `1`, 1, false}},
		{"a revision of zero", []any{"macros", "m3", `1`, 0, false}},
		{"a tombstone with a value", []any{"macros", "m3", `1`, 5, true}},
		{"a live row without a value", []any{"macros", "m3", nil, 5, false}},
	}
	for _, tc := range refused {
		if err := db.Exec(insert, tc.args...).Error; err == nil {
			t.Errorf("%s was accepted", tc.name)
		}
	}
}

func TestLocalUISettingsRollBack(t *testing.T) {
	db := openMigratedTo(t, "0068_local_ui_settings")
	if err := gormigrate.New(db, gormigrate.DefaultOptions, All()).RollbackTo("0066_command_workflow_error"); err != nil {
		t.Fatalf("rollback: %v", err)
	}
	for _, table := range []string{"local_ui_settings", "local_ui_settings_revision"} {
		exists, err := tableExists(db, table)
		if err != nil {
			t.Fatalf("tableExists(%s): %v", table, err)
		}
		if exists {
			t.Errorf("%s survived the rollback", table)
		}
	}
}
