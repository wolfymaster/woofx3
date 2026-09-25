package sqlite

import (
	"fmt"
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
)

// Indexes whose key includes application_id. They are dropped explicitly
// before the column, because SQLite refuses to drop an indexed column.
var applicationIndexes = []string{
	"idx_actions_application_id",
	"idx_alerts_application_created_at",
	"idx_commands_application_id",
	"idx_overlay_tokens_application_id",
	"idx_permission_application_id",
	"idx_rr_application",
	"idx_resources_app_kind",
	"idx_resources_app_parent",
	"idx_scenes_application_id",
	"idx_scenes_application_name",
	"idx_stream_session_segments_one_open_per_app",
	"idx_stream_sessions_app_started_at",
	"idx_stream_sessions_one_open_per_app",
	"idx_triggers_application_id",
	"idx_widget_status_application_canonical",
	"idx_widget_status_application_module",
	"idx_widgets_application_id",
	"idx_worker_events_application_id",
	"idx_workflow_definitions_application_enabled",
	"idx_workflow_definitions_application_id",
	"idx_workflow_executions_app_started_at",
	"idx_workflow_executions_application_id",
}

// Tables whose application_id carries a FOREIGN KEY or sits in a table-level
// UNIQUE constraint. SQLite cannot drop such a column in place.
var applicationRebuilds = []tableRebuild{
	{table: "alerts", dropColumn: "application_id"},
	{table: "clients", dropColumn: "application_id"},
	{table: "commands", dropColumn: "application_id"},
	{table: "groups", dropColumn: "application_id"},
	{table: "permissions", dropColumn: "application_id"},
	{table: "resources", dropColumn: "application_id"},
	{table: "scene_events", dropColumn: "application_id"},
	{table: "scenes", dropColumn: "application_id"},
	{table: "settings", dropColumn: "application_id"},
	{table: "stream_session_segments", dropColumn: "application_id"},
	{table: "stream_sessions", dropColumn: "application_id"},
	{table: "user_events", dropColumn: "application_id"},
	{table: "widget_status", dropColumn: "application_id"},
	{table: "workflow_definitions", dropColumn: "application_id"},
	{table: "workflow_execution_steps", dropColumn: "application_id"},
	// A run recorded by the engine itself has no user to attribute it to.
	{table: "workflow_executions", dropColumn: "application_id", nullable: []string{"user_id"}},
}

// Tables whose application_id is a plain column, droppable in place once its
// index is gone.
var applicationPlainColumnTables = []string{
	"actions",
	"background_tasks",
	"overlay_tokens",
	"resource_references",
	"triggers",
	"widgets",
	"worker_events",
}

// Replacements for the indexes above that scoped a rule or a read to one
// application. Names match the index tags on the models in
// database/models so the schema and the structs agree.
//
// The two "one open" indexes let at most one row satisfy the WHERE clause:
// every such row has the same key (status is 'open'; ended_at IS NULL is
// true), so a second one collides. ended_at itself cannot be the key because
// SQLite treats NULLs as distinct in a unique index.
var engineWideIndexes = []string{
	`CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_key ON settings (key)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS idx_scenes_name ON scenes (name)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS idx_groups_name ON groups (name)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS widget_status_unique ON widget_status (instance_id, key)`,
	`CREATE INDEX IF NOT EXISTS idx_widget_status_module ON widget_status (module_id)`,
	`CREATE INDEX IF NOT EXISTS idx_widget_status_canonical_id
		ON widget_status (widget_canonical_id) WHERE widget_canonical_id <> ''`,
	`CREATE UNIQUE INDEX IF NOT EXISTS idx_stream_sessions_one_open
		ON stream_sessions (status) WHERE status = 'open'`,
	`CREATE INDEX IF NOT EXISTS idx_stream_sessions_started_at ON stream_sessions (started_at DESC)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS idx_stream_session_segments_one_open
		ON stream_session_segments ((ended_at IS NULL)) WHERE ended_at IS NULL`,
	`CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts (created_at DESC)`,
	`CREATE INDEX IF NOT EXISTS idx_resources_kind ON resources (kind)`,
	`CREATE INDEX IF NOT EXISTS idx_resources_parent_id ON resources (parent_id)`,
	`CREATE INDEX IF NOT EXISTS idx_workflow_definitions_enabled ON workflow_definitions (enabled)`,
	// workflow_executions (started_at) is already covered by
	// idx_workflow_executions_started_at from the initial schema; SQLite walks
	// it backwards for newest-first reads.
}

// DropApplications removes the application concept: an engine is
// single-tenant, so every row belongs to the engine and nothing is scoped any
// further. See the postgres migration of the same ID for the rationale.
//
// Most tables need a rebuild (see rebuildTable), which drops and recreates a
// parent table. Foreign key enforcement is turned off for that, so child rows
// are not cascade-deleted, and the whole change runs in one transaction that
// checks every foreign key before it commits.
func DropApplications() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0047_drop_applications",
		Migrate: func(db *gorm.DB) error {
			log.Println("Dropping applications...")
			err := withForeignKeysDisabled(db, func(conn *gorm.DB) error {
				return conn.Transaction(dropApplications)
			})
			if err != nil {
				return err
			}
			log.Println("applications drop complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			// Not reversible: the application a row belonged to is gone, and
			// with no application left to point at, the NOT NULL foreign keys
			// cannot be restored. Rollback is a deliberate no-op.
			return nil
		},
	}
}

func dropApplications(tx *gorm.DB) error {
	if err := assertAtMostOneApplication(tx); err != nil {
		return err
	}

	for _, index := range applicationIndexes {
		if err := tx.Exec(fmt.Sprintf("DROP INDEX IF EXISTS %s", index)).Error; err != nil {
			return err
		}
	}
	for _, rebuild := range applicationRebuilds {
		if err := rebuildTable(tx, rebuild); err != nil {
			return err
		}
	}
	for _, table := range applicationPlainColumnTables {
		if err := execSQL(tx, fmt.Sprintf("ALTER TABLE %s DROP COLUMN IF EXISTS application_id", table)); err != nil {
			return err
		}
	}
	if err := execStatements(tx, []string{
		`DROP TABLE IF EXISTS user_applications`,
		`DROP TABLE IF EXISTS applications`,
	}); err != nil {
		return err
	}
	if err := assertNoApplicationColumns(tx); err != nil {
		return err
	}

	if err := execStatements(tx, engineWideIndexes); err != nil {
		return err
	}
	if err := seedEngineBuiltInGroups(tx); err != nil {
		return err
	}
	return assertForeignKeysHold(tx)
}

// assertAtMostOneApplication refuses to merge several applications' data into
// one engine-wide set: their settings, groups and scenes would collide, and
// there is no correct way to choose between them.
func assertAtMostOneApplication(tx *gorm.DB) error {
	exists, err := tableExists(tx, "applications")
	if err != nil {
		return err
	}
	if !exists {
		return nil
	}
	var count int64
	if err := tx.Raw(`SELECT COUNT(*) FROM applications`).Scan(&count).Error; err != nil {
		return err
	}
	if count > 1 {
		return fmt.Errorf(
			"this engine holds %d applications; an engine is single-tenant and this migration "+
				"cannot choose which one's data to keep, so remove the extra applications first",
			count,
		)
	}
	return nil
}

func assertNoApplicationColumns(tx *gorm.DB) error {
	var tables []string
	if err := tx.Raw(
		`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
	).Scan(&tables).Error; err != nil {
		return err
	}
	for _, table := range tables {
		has, err := columnExists(tx, table, "application_id")
		if err != nil {
			return err
		}
		if has {
			return fmt.Errorf("%s.application_id survived the migration; add the table to 0047_drop_applications", table)
		}
	}
	return nil
}

// seedEngineBuiltInGroups makes sure the engine has exactly one set of
// built-in groups. An engine that had an application already has them and is
// left as is; one that never had an application gets them here. A group an
// operator made under a built-in name is promoted rather than duplicated.
func seedEngineBuiltInGroups(tx *gorm.DB) error {
	for _, g := range models.BuiltInGroups {
		promoted := tx.Exec(`UPDATE groups SET is_built_in = 1 WHERE name = ?`, g.Name)
		if promoted.Error != nil {
			return promoted.Error
		}
		if promoted.RowsAffected > 0 {
			continue
		}
		if err := tx.Exec(
			`INSERT INTO groups (id, name, description, is_built_in) VALUES (?, ?, ?, 1)`,
			uuid.New(), g.Name, g.Description,
		).Error; err != nil {
			return err
		}
	}
	return nil
}
