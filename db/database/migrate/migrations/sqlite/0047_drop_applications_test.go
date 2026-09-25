package sqlite

import (
	"strings"
	"testing"

	gsqlite "github.com/glebarez/sqlite"
	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
)

const (
	testAppID  = "00000000-0000-0000-0000-00000000a001"
	testUserID = "00000000-0000-0000-0000-00000000b001"
)

// openMigratedTo opens an in-memory database with foreign keys on, as db-proxy
// opens its file, and applies the chain up to and including migrationID.
func openMigratedTo(t *testing.T, migrationID string) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(gsqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("sql db: %v", err)
	}
	// Every connection to :memory: is a separate database.
	sqlDB.SetMaxOpenConns(1)
	if err := db.Exec(`PRAGMA foreign_keys = ON`).Error; err != nil {
		t.Fatalf("enable foreign keys: %v", err)
	}
	if err := gormigrate.New(db, gormigrate.DefaultOptions, All()).MigrateTo(migrationID); err != nil {
		t.Fatalf("migrate to %s: %v", migrationID, err)
	}
	return db
}

func migrateAll(db *gorm.DB) error {
	return gormigrate.New(db, gormigrate.DefaultOptions, All()).Migrate()
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

// seedOneApplication writes one application and rows that reference it,
// across tables that are rebuilt, tables that only lose a column, parents
// whose children must survive the rebuild, and an AUTOINCREMENT table.
func seedOneApplication(t *testing.T, db *gorm.DB) {
	t.Helper()
	mustExec(t, db, `INSERT INTO users (id, username, user_id) VALUES (?, 'wolfy', '42')`, testUserID)
	mustExec(t, db, `INSERT INTO applications (id, name, user_id, is_default) VALUES (?, 'default', ?, 1)`,
		testAppID, testUserID)
	mustExec(t, db, `INSERT INTO user_applications (id, user_id, application_id, role) VALUES ('ua1', ?, ?, 'owner')`,
		testUserID, testAppID)

	mustExec(t, db, `INSERT INTO settings (application_id, key, value) VALUES (?, 'scene.publicUrl', 'x')`, testAppID)
	mustExec(t, db, `INSERT INTO settings (application_id, key, value) VALUES (?, 'twitch.token', 'y')`, testAppID)
	mustExec(t, db, `DELETE FROM settings WHERE key = 'twitch.token'`)

	mustExec(t, db, `INSERT INTO groups (id, application_id, name, is_built_in) VALUES ('g-mod', ?, ?, 1)`,
		testAppID, models.GroupModerator)
	mustExec(t, db, `INSERT INTO groups (id, application_id, name) VALUES ('g-custom', ?, 'regulars')`, testAppID)

	mustExec(t, db, `INSERT INTO scenes (id, application_id, name) VALUES ('s1', ?, 'Main')`, testAppID)
	mustExec(t, db, `INSERT INTO scene_events (id, scene_id, application_id, type, key, occurred_at)
		VALUES ('se1', 's1', ?, 'state', 'k', '2026-01-01')`, testAppID)

	mustExec(t, db, `INSERT INTO workflow_definitions (id, application_id, name) VALUES ('wd1', ?, 'wf')`, testAppID)
	mustExec(t, db, `INSERT INTO workflow_executions (id, workflow_id, application_id, user_id)
		VALUES ('we1', 'wd1', ?, ?)`, testAppID, testUserID)
	mustExec(t, db, `INSERT INTO workflow_execution_steps (id, execution_id, application_id, task_id, status, step_index)
		VALUES ('ws1', 'we1', ?, 't1', 'completed', 0)`, testAppID)

	mustExec(t, db, `INSERT INTO stream_sessions (id, application_id) VALUES ('ss1', ?)`, testAppID)
	mustExec(t, db, `INSERT INTO stream_session_segments (id, application_id, stream_session_id)
		VALUES ('seg1', ?, 'ss1')`, testAppID)

	mustExec(t, db, `INSERT INTO triggers (id, name, event, application_id) VALUES ('tr1', 'follow', 'follow', ?)`,
		testAppID)
}

func TestDropApplicationsKeepsTheOneApplicationsData(t *testing.T) {
	db := openMigratedTo(t, "0046_widget_taxonomy")
	seedOneApplication(t, db)

	if err := migrateAll(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	var tables []string
	if err := db.Raw(`SELECT name FROM sqlite_master WHERE type = 'table'`).Scan(&tables).Error; err != nil {
		t.Fatalf("list tables: %v", err)
	}
	for _, table := range tables {
		if table == "applications" || table == "user_applications" || strings.HasSuffix(table, "__rebuild") {
			t.Errorf("table %s survived", table)
		}
		has, err := columnExists(db, table, "application_id")
		if err != nil {
			t.Fatalf("columns of %s: %v", table, err)
		}
		if has {
			t.Errorf("%s.application_id survived", table)
		}
	}

	for _, index := range []string{
		"idx_settings_key",
		"idx_scenes_name",
		"idx_groups_name",
		"widget_status_unique",
		"idx_stream_sessions_one_open",
		"idx_stream_session_segments_one_open",
	} {
		if count(t, db, `SELECT COUNT(*) FROM pragma_index_list(
				(SELECT tbl_name FROM sqlite_master WHERE type = 'index' AND name = ?)
			) WHERE name = ? AND "unique" = 1`, index, index) != 1 {
			t.Errorf("unique index %s missing", index)
		}
	}
	for _, index := range []string{
		"idx_widget_status_module",
		"idx_widget_status_canonical_id",
		"idx_stream_sessions_started_at",
		"idx_alerts_created_at",
		"idx_resources_kind",
		"idx_resources_parent_id",
		"idx_workflow_definitions_enabled",
		// Indexes of rebuilt tables that never involved the application.
		"idx_workflow_executions_started_at",
		"idx_stream_session_segments_session_started_at",
		"idx_workflow_execution_steps_attempt",
	} {
		if count(t, db, `SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = ?`, index) != 1 {
			t.Errorf("index %s missing", index)
		}
	}

	survivors := map[string]int64{
		"settings":                 1,
		"scenes":                   1,
		"scene_events":             1,
		"workflow_definitions":     1,
		"workflow_executions":      1,
		"workflow_execution_steps": 1,
		"stream_sessions":          1,
		"stream_session_segments":  1,
		"triggers":                 1,
		"users":                    1,
	}
	for table, want := range survivors {
		if got := count(t, db, `SELECT COUNT(*) FROM `+table); got != want {
			t.Errorf("%s has %d rows, want %d", table, got, want)
		}
	}

	for _, g := range models.BuiltInGroups {
		if got := count(t, db, `SELECT COUNT(*) FROM groups WHERE name = ? AND is_built_in = 1`, g.Name); got != 1 {
			t.Errorf("built-in group %s appears %d times, want 1", g.Name, got)
		}
	}
	if count(t, db, `SELECT COUNT(*) FROM groups WHERE id = 'g-mod'`) != 1 {
		t.Error("the existing moderator group was replaced instead of kept")
	}
	if count(t, db, `SELECT COUNT(*) FROM groups WHERE name = 'regulars' AND is_built_in = 0`) != 1 {
		t.Error("custom group lost")
	}

	enabled, err := foreignKeysEnabled(db)
	if err != nil {
		t.Fatalf("read foreign_keys: %v", err)
	}
	if !enabled {
		t.Error("foreign_keys left disabled")
	}
	if err := assertForeignKeysHold(db); err != nil {
		t.Error(err)
	}

	// The AUTOINCREMENT counter keeps the deleted setting's id retired.
	mustExec(t, db, `INSERT INTO settings (key, value) VALUES ('another', 'z')`)
	if got := count(t, db, `SELECT id FROM settings WHERE key = 'another'`); got != 3 {
		t.Errorf("new setting id = %d, want 3", got)
	}

	if err := db.Exec(`INSERT INTO settings (key, value) VALUES ('scene.publicUrl', 'dup')`).Error; err == nil {
		t.Error("duplicate setting key accepted")
	}
	if err := db.Exec(`INSERT INTO stream_sessions (id) VALUES ('ss2')`).Error; err == nil {
		t.Error("second open stream session accepted")
	}
	if err := db.Exec(`INSERT INTO stream_session_segments (id, stream_session_id) VALUES ('seg2', 'ss1')`).Error; err == nil {
		t.Error("second open segment accepted")
	}
	mustExec(t, db, `INSERT INTO workflow_executions (id, workflow_id) VALUES ('we2', 'wd1')`)

	// Foreign keys into rebuilt parents still hold and still cascade.
	if err := db.Exec(`INSERT INTO scene_events (id, scene_id, type, key, occurred_at)
		VALUES ('se2', 'missing', 'state', 'k', '2026-01-01')`).Error; err == nil {
		t.Error("scene event for a missing scene accepted")
	}
	mustExec(t, db, `DELETE FROM scenes WHERE id = 's1'`)
	if got := count(t, db, `SELECT COUNT(*) FROM scene_events`); got != 0 {
		t.Errorf("scene_events after deleting the scene = %d, want 0", got)
	}
}

func TestDropApplicationsSeedsBuiltInGroupsWhenThereWasNoApplication(t *testing.T) {
	db := openMigratedTo(t, "0046_widget_taxonomy")

	if err := migrateAll(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	for _, g := range models.BuiltInGroups {
		if got := count(t, db, `SELECT COUNT(*) FROM groups WHERE name = ? AND is_built_in = 1`, g.Name); got != 1 {
			t.Errorf("built-in group %s appears %d times, want 1", g.Name, got)
		}
	}
}

func TestDropApplicationsRefusesSeveralApplications(t *testing.T) {
	db := openMigratedTo(t, "0046_widget_taxonomy")
	seedOneApplication(t, db)
	mustExec(t, db, `INSERT INTO applications (id, name, user_id) VALUES ('second', 'other', ?)`, testUserID)

	err := migrateAll(db)
	if err == nil || !strings.Contains(err.Error(), "2 applications") {
		t.Fatalf("migrate error = %v, want one naming 2 applications", err)
	}
	if count(t, db, `SELECT COUNT(*) FROM applications`) != 2 {
		t.Error("applications changed despite the refusal")
	}
	has, err := columnExists(db, "settings", "application_id")
	if err != nil {
		t.Fatalf("columns of settings: %v", err)
	}
	if !has {
		t.Error("settings changed despite the refusal")
	}
}

func TestDropApplicationsRefusesToRunInsideATransaction(t *testing.T) {
	db := openMigratedTo(t, "0046_widget_taxonomy")
	seedOneApplication(t, db)

	options := *gormigrate.DefaultOptions
	options.UseTransaction = true
	if err := gormigrate.New(db, &options, All()).Migrate(); err == nil {
		t.Fatal("migrate inside a transaction succeeded; foreign keys cannot have been disabled")
	}
	if count(t, db, `SELECT COUNT(*) FROM scene_events`) != 1 {
		t.Error("scene_events lost")
	}
}
