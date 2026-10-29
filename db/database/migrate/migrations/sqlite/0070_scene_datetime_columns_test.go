package sqlite

import (
	"testing"
	"time"

	"github.com/wolfymaster/woofx3/db/database/models"
)

func TestSceneDatetimeColumnsKeepScenesReadable(t *testing.T) {
	db := openMigratedTo(t, "0069_revoke_ungranted_command_wildcards")
	// One value in SQLite's own datetime('now') shape, one in the shape the
	// driver writes a time.Time in.
	mustExec(t, db, `INSERT INTO scenes (id, name, created_at, updated_at)
		VALUES ('00000000-0000-0000-0000-00000000c0e1', 'main', '2026-09-27 20:00:00', '2026-09-27 23:30:00.5-05:00')`)

	if err := migrateAll(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	var scenes []models.Scene
	if err := db.Find(&scenes).Error; err != nil {
		t.Fatalf("read scenes: %v", err)
	}
	if len(scenes) != 1 {
		t.Fatalf("scenes rows = %d, want the original 1", len(scenes))
	}
	if want := time.Date(2026, 9, 27, 20, 0, 0, 0, time.UTC); !scenes[0].CreatedAt.Equal(want) {
		t.Errorf("created_at = %v, want %v", scenes[0].CreatedAt, want)
	}
	if want := time.Date(2026, 9, 28, 4, 30, 0, 500_000_000, time.UTC); !scenes[0].UpdatedAt.Equal(want) {
		t.Errorf("updated_at = %v, want %v", scenes[0].UpdatedAt, want)
	}

	// Names stay unique per kind across the rebuild.
	if err := db.Exec(`INSERT INTO scenes (id, name) VALUES ('00000000-0000-0000-0000-00000000c0e2', 'main')`).Error; err == nil {
		t.Error("a second scene named main was accepted")
	}
}

func TestSceneDatetimeColumnsRerunIsANoOp(t *testing.T) {
	db := openMigratedTo(t, "0070_scene_datetime_columns")
	before := count(t, db, `SELECT COUNT(*) FROM sqlite_master`)

	if err := DeclareSceneDatetimeColumns().Migrate(db); err != nil {
		t.Fatalf("rerun: %v", err)
	}
	if after := count(t, db, `SELECT COUNT(*) FROM sqlite_master`); after != before {
		t.Errorf("schema objects = %d after a rerun, want %d", after, before)
	}
}
