package postgres

import (
	"os"
	"strings"
	"testing"

	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/wolfymaster/woofx3/db/database/models"
	pgdriver "gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// postgresTestURLEnv names a Postgres database the migration tests may
// migrate. It must be empty: the tests refuse to touch a database that already
// has tables. Without it the tests are skipped.
const postgresTestURLEnv = "WOOFX3_MIGRATION_TEST_POSTGRES_URL"

const (
	testAppID  = "00000000-0000-0000-0000-00000000a001"
	testUserID = "00000000-0000-0000-0000-00000000b001"
)

// openEmptyPostgres connects to the database named by postgresTestURLEnv and
// clears it again when the test ends.
func openEmptyPostgres(t *testing.T) *gorm.DB {
	t.Helper()
	url := os.Getenv(postgresTestURLEnv)
	if url == "" {
		t.Skipf("%s not set", postgresTestURLEnv)
	}
	db, err := gorm.Open(pgdriver.Open(url), &gorm.Config{})
	if err != nil {
		t.Fatalf("open postgres: %v", err)
	}
	var tables int64
	if err := db.Raw(`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'`).
		Scan(&tables).Error; err != nil {
		t.Fatalf("count tables: %v", err)
	}
	if tables > 0 {
		t.Fatalf("%s points at a database with %d tables; use an empty, throwaway one", postgresTestURLEnv, tables)
	}
	t.Cleanup(func() {
		db.Exec(`DROP SCHEMA public CASCADE`)
		db.Exec(`CREATE SCHEMA public`)
	})
	if err := db.Exec(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`).Error; err != nil {
		t.Fatalf("enable uuid-ossp: %v", err)
	}
	return db
}

func mustExec(t *testing.T, db *gorm.DB, stmt string, args ...any) {
	t.Helper()
	if err := db.Exec(stmt, args...).Error; err != nil {
		t.Fatalf("%s: %v", stmt, err)
	}
}

func count(t *testing.T, db *gorm.DB, query string, args ...any) int64 {
	t.Helper()
	var n int64
	if err := db.Raw(query, args...).Scan(&n).Error; err != nil {
		t.Fatalf("%s: %v", query, err)
	}
	return n
}

func seedOneApplication(t *testing.T, db *gorm.DB) {
	t.Helper()
	mustExec(t, db, `INSERT INTO users (id, username, user_id) VALUES (?, 'wolfy', '42')`, testUserID)
	mustExec(t, db, `INSERT INTO applications (id, name, user_id, is_default) VALUES (?, 'default', ?, TRUE)`,
		testAppID, testUserID)
	mustExec(t, db, `INSERT INTO user_applications (user_id, application_id, role) VALUES (?, ?, 'owner')`,
		testUserID, testAppID)
	mustExec(t, db, `INSERT INTO settings (application_id, key, value) VALUES (?, 'scene.publicUrl', 'x')`, testAppID)
	mustExec(t, db, `INSERT INTO groups (id, application_id, name, is_built_in)
		VALUES (uuid_generate_v4(), ?, ?, TRUE)`, testAppID, models.GroupModerator)
	mustExec(t, db, `INSERT INTO scenes (application_id, name) VALUES (?, 'Main')`, testAppID)
	mustExec(t, db, `INSERT INTO scene_events (scene_id, application_id, type, key, occurred_at)
		SELECT id, application_id, 'state', 'k', NOW() FROM scenes`)
	mustExec(t, db, `INSERT INTO workflow_definitions (application_id, name) VALUES (?, 'wf')`, testAppID)
	mustExec(t, db, `INSERT INTO workflow_executions (workflow_id, application_id, user_id)
		SELECT id, application_id, ? FROM workflow_definitions`, testUserID)
	mustExec(t, db, `INSERT INTO stream_sessions (application_id) VALUES (?)`, testAppID)
	mustExec(t, db, `INSERT INTO stream_session_segments (application_id, stream_session_id)
		SELECT application_id, id FROM stream_sessions`)
}

func TestDropApplicationsKeepsTheOneApplicationsData(t *testing.T) {
	db := openEmptyPostgres(t)
	if err := gormigrate.New(db, gormigrate.DefaultOptions, All()).MigrateTo("0046_widget_taxonomy"); err != nil {
		t.Fatalf("migrate to 0046: %v", err)
	}
	seedOneApplication(t, db)

	if err := gormigrate.New(db, gormigrate.DefaultOptions, All()).Migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	if got := count(t, db, `SELECT COUNT(*) FROM information_schema.columns
		WHERE table_schema = 'public' AND column_name = 'application_id'`); got != 0 {
		t.Errorf("%d application_id columns survived", got)
	}
	if got := count(t, db, `SELECT COUNT(*) FROM information_schema.tables
		WHERE table_schema = 'public' AND table_name IN ('applications', 'user_applications')`); got != 0 {
		t.Errorf("%d application tables survived", got)
	}
	for _, index := range []string{
		"idx_settings_key", "idx_scenes_name", "idx_groups_name", "widget_status_unique",
		"idx_stream_sessions_one_open", "idx_stream_session_segments_one_open",
	} {
		if count(t, db, `SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = ?
			AND indexdef LIKE 'CREATE UNIQUE INDEX%'`, index) != 1 {
			t.Errorf("unique index %s missing", index)
		}
	}
	for table, want := range map[string]int64{
		"settings": 1, "scenes": 1, "scene_events": 1, "workflow_executions": 1,
		"stream_sessions": 1, "stream_session_segments": 1,
	} {
		if got := count(t, db, `SELECT COUNT(*) FROM `+table); got != want {
			t.Errorf("%s has %d rows, want %d", table, got, want)
		}
	}
	for _, g := range models.BuiltInGroups {
		if got := count(t, db, `SELECT COUNT(*) FROM groups WHERE name = ? AND is_built_in`, g.Name); got != 1 {
			t.Errorf("built-in group %s appears %d times, want 1", g.Name, got)
		}
	}

	if err := db.Exec(`INSERT INTO settings (key, value) VALUES ('scene.publicUrl', 'dup')`).Error; err == nil {
		t.Error("duplicate setting key accepted")
	}
	if err := db.Exec(`INSERT INTO stream_sessions DEFAULT VALUES`).Error; err == nil {
		t.Error("second open stream session accepted")
	}
	if err := db.Exec(`INSERT INTO stream_session_segments (stream_session_id)
		SELECT id FROM stream_sessions`).Error; err == nil {
		t.Error("second open segment accepted")
	}
	mustExec(t, db, `INSERT INTO workflow_executions (workflow_id) SELECT id FROM workflow_definitions`)
}

func TestDropApplicationsRefusesSeveralApplications(t *testing.T) {
	db := openEmptyPostgres(t)
	if err := gormigrate.New(db, gormigrate.DefaultOptions, All()).MigrateTo("0046_widget_taxonomy"); err != nil {
		t.Fatalf("migrate to 0046: %v", err)
	}
	seedOneApplication(t, db)
	mustExec(t, db, `INSERT INTO applications (name, user_id) VALUES ('other', ?)`, testUserID)

	err := gormigrate.New(db, gormigrate.DefaultOptions, All()).Migrate()
	if err == nil || !strings.Contains(err.Error(), "2 applications") {
		t.Fatalf("migrate error = %v, want one naming 2 applications", err)
	}
	if count(t, db, `SELECT COUNT(*) FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'settings' AND column_name = 'application_id'`) != 1 {
		t.Error("settings changed despite the refusal")
	}
}
