package repository

import (
	"testing"

	gsqlite "github.com/libtnb/sqlite"
	"gorm.io/gorm"
)

func newSettingsDb(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(gsqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	err = db.Exec(`CREATE TABLE module_settings (
		id         TEXT NOT NULL PRIMARY KEY,
		module_id  TEXT NOT NULL,
		key        TEXT NOT NULL,
		value      TEXT DEFAULT '' NOT NULL,
		value_type TEXT DEFAULT 'string' NOT NULL,
		created_at DATETIME DEFAULT (datetime('now')) NOT NULL,
		updated_at DATETIME DEFAULT (datetime('now')) NOT NULL,
		CONSTRAINT uq_module_setting UNIQUE (module_id, key)
	)`).Error
	if err != nil {
		t.Fatalf("create table: %v", err)
	}
	err = db.Exec(`INSERT INTO module_settings (id, module_id, key, value, value_type)
		VALUES ('7b0b2d0e-6a51-4a0c-9a55-2f1b3c4d5e6f', 'wheel', 'items', '[]', 'list')`).Error
	if err != nil {
		t.Fatalf("seed: %v", err)
	}
	return db
}

func storedValue(t *testing.T, r ModuleSettingRepository) string {
	t.Helper()
	rows, err := r.ListByModule("wheel")
	if err != nil || len(rows) != 1 {
		t.Fatalf("ListByModule = %v, %v", rows, err)
	}
	return rows[0].Value
}

func TestCompareAndSetWritesWhenTheValueIsAsExpected(t *testing.T) {
	r := NewModuleSettingRepository(newSettingsDb(t))

	swapped, err := r.CompareAndSet("wheel", "items", "[]", `[{"label":"Pizza"}]`)

	if err != nil || !swapped {
		t.Fatalf("CompareAndSet = %v, %v; want swapped", swapped, err)
	}
	if got := storedValue(t, r); got != `[{"label":"Pizza"}]` {
		t.Errorf("stored %q", got)
	}
}

// The second of two writers that both read "[]" must not overwrite the first.
func TestCompareAndSetRefusesAStaleExpectation(t *testing.T) {
	r := NewModuleSettingRepository(newSettingsDb(t))
	if _, err := r.CompareAndSet("wheel", "items", "[]", `[{"label":"Pizza"}]`); err != nil {
		t.Fatal(err)
	}

	swapped, err := r.CompareAndSet("wheel", "items", "[]", `[{"label":"Tacos"}]`)

	if err != nil || swapped {
		t.Fatalf("CompareAndSet = %v, %v; want refused", swapped, err)
	}
	if got := storedValue(t, r); got != `[{"label":"Pizza"}]` {
		t.Errorf("stored %q", got)
	}
}

func TestCompareAndSetNeverCreatesAMissingSetting(t *testing.T) {
	r := NewModuleSettingRepository(newSettingsDb(t))

	swapped, err := r.CompareAndSet("wheel", "other", "", "x")

	if err != nil || swapped {
		t.Fatalf("CompareAndSet = %v, %v; want refused", swapped, err)
	}
}
