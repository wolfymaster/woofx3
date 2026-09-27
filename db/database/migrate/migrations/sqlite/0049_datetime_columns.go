package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// datetimeRebuilds lists every TEXT column a model in database/models reads
// into a time.Time. Kept literal rather than derived from the models, so the
// migration means the same thing however the models change later.
var datetimeRebuilds = []tableRebuild{
	{table: "actions", datetime: []string{"archived_at", "created_at", "updated_at"}},
	{table: "alerts", datetime: []string{"dispatched_at", "played_at", "completed_at", "created_at", "updated_at"}},
	{table: "assets", datetime: []string{"created_at", "updated_at"}},
	{table: "background_tasks", datetime: []string{"created_at", "updated_at"}},
	{table: "commands", datetime: []string{"created_at"}},
	{table: "functions", datetime: []string{"archived_at"}},
	{table: "groups", datetime: []string{"created_at", "updated_at"}},
	{table: "module_resource_instances", datetime: []string{"created_at", "updated_at"}},
	{table: "module_resources", datetime: []string{"installed_at", "updated_at"}},
	{table: "module_settings", datetime: []string{"created_at", "updated_at"}},
	{table: "modules", datetime: []string{"installed_at", "updated_at"}},
	{table: "overlay_tokens", datetime: []string{"created_at", "revoked_at", "last_used_at"}},
	{table: "resource_references", datetime: []string{"created_at", "updated_at"}},
	{table: "resources", datetime: []string{"created_at", "updated_at"}},
	{table: "scene_event_deliveries", datetime: []string{"delivered_at", "completed_at", "last_attempt_at", "created_at"}},
	{table: "scene_event_log", datetime: []string{"occurred_at", "created_at"}},
	{table: "scene_events", datetime: []string{"occurred_at", "created_at"}},
	{table: "settings", datetime: []string{"created_at", "updated_at"}},
	{table: "stream_session_segments", datetime: []string{"started_at", "ended_at", "created_at", "updated_at"}},
	{table: "stream_sessions", datetime: []string{"started_at", "ended_at", "created_at", "updated_at"}},
	{table: "triggers", datetime: []string{"archived_at", "created_at", "updated_at"}},
	{table: "user_groups", datetime: []string{"created_at"}},
	{table: "user_meta", datetime: []string{"created_at"}},
	{table: "users", datetime: []string{"deleted_at", "created_at", "updated_at"}},
	{table: "widget_settings", datetime: []string{"created_at", "updated_at"}},
	{table: "widget_status", datetime: []string{"occurred_at", "created_at", "updated_at"}},
	{table: "widgets", datetime: []string{"archived_at", "created_at", "updated_at"}},
	{table: "worker_events", datetime: []string{"published_at", "acknowledged_at", "created_at", "updated_at"}},
	{table: "workflow_execution_steps", datetime: []string{"started_at", "completed_at", "created_at", "updated_at"}},
	{table: "workflow_executions", datetime: []string{"started_at", "completed_at", "created_at", "updated_at"}},
}

// DeclareDatetimeColumns re-declares timestamp columns as DATETIME so the
// engine can read its own rows back.
//
// The SQLite driver decodes a stored timestamp into a time.Time only when the
// column is declared as a date or time type; for a TEXT column it returns the
// string, and scanning a string into a time.Time fails. Every read of a row
// with such a column errored, which made the affected services write-only on
// SQLite.
//
// Only the declared type changes: stored values are copied as they are, and
// DATETIME's NUMERIC affinity leaves timestamp text as text. Both shapes
// already stored, SQLite's `datetime('now')` and the driver's own format with
// fractional seconds and a zone offset, are ones the driver decodes.
//
// Every table here needs a rebuild (see rebuildTable), so this runs like
// 0047_drop_applications: foreign key enforcement off, one transaction, and a
// foreign key check before commit.
func DeclareDatetimeColumns() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0049_datetime_columns",
		Migrate: func(db *gorm.DB) error {
			log.Println("Declaring timestamp columns DATETIME...")
			err := withForeignKeysDisabled(db, func(conn *gorm.DB) error {
				return conn.Transaction(declareDatetimeColumns)
			})
			if err != nil {
				return err
			}
			log.Println("datetime columns migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			// Declaring the columns TEXT again would make every row with a
			// timestamp unreadable. Rollback is a deliberate no-op.
			return nil
		},
	}
}

func declareDatetimeColumns(tx *gorm.DB) error {
	for _, rebuild := range datetimeRebuilds {
		if err := rebuildTable(tx, rebuild); err != nil {
			return err
		}
	}
	return assertForeignKeysHold(tx)
}
