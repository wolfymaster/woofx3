package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddViewerFacts creates the per-viewer fact tables. See the postgres
// migration of the same ID for the shape decisions.
//
// Timestamps are DATETIME so the driver returns them as a time.Time.
func AddViewerFacts() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0057_viewer_facts",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Creating viewer fact tables...")
			if err := execStatements(tx, []string{
				`CREATE TABLE IF NOT EXISTS fact_definitions (
					id                 TEXT                                NOT NULL PRIMARY KEY,
					name               TEXT                                NOT NULL,
					description        TEXT     DEFAULT ''                 NOT NULL,
					definition         TEXT                                NOT NULL,
					aggregate_fn       TEXT                               NOT NULL CHECK (aggregate_fn IN ('count', 'sum', 'min', 'max', 'last', 'first_at', 'last_at', 'sessions', 'session_streak')),
					value_kind         TEXT                                NOT NULL CHECK (value_kind IN ('number', 'string', 'timestamp')),
					window_kind        TEXT                                NOT NULL CHECK (window_kind IN ('lifetime', 'session')),
					revision           INTEGER  DEFAULT 1                  NOT NULL CHECK (revision >= 1),
					created_by_type    TEXT     DEFAULT 'USER'             NOT NULL,
					created_by_ref     TEXT     DEFAULT ''                 NOT NULL,
					counting_since     DATETIME DEFAULT (datetime('now'))  NOT NULL,
					backfilled_through DATETIME                            NULL,
					created_at         DATETIME DEFAULT (datetime('now'))  NOT NULL,
					updated_at         DATETIME DEFAULT (datetime('now'))  NOT NULL
				)`,
				`CREATE TABLE IF NOT EXISTS fact_values (
					fact_id      TEXT                                NOT NULL REFERENCES fact_definitions(id) ON UPDATE CASCADE ON DELETE CASCADE,
					platform     TEXT                                NOT NULL,
					subject_id   TEXT                                NOT NULL,
					window_key   TEXT     DEFAULT ''                 NOT NULL,
					num_value    REAL                                NULL,
					str_value    TEXT                                NULL,
					value_at_ms  INTEGER                            NULL,
					subject_name TEXT                                NULL,
					updated_at   DATETIME DEFAULT (datetime('now'))  NOT NULL,
					PRIMARY KEY (fact_id, platform, subject_id, window_key)
				)`,
				`CREATE INDEX IF NOT EXISTS idx_fact_values_fact_window_num
					ON fact_values (fact_id, window_key, num_value)`,
				`CREATE INDEX IF NOT EXISTS idx_fact_values_subject
					ON fact_values (platform, subject_id)`,
				`CREATE TABLE IF NOT EXISTS fact_applied_events (
					source     TEXT                                NOT NULL,
					event_id   TEXT                                NOT NULL,
					applied_at DATETIME DEFAULT (datetime('now'))  NOT NULL,
					PRIMARY KEY (source, event_id)
				)`,
				`CREATE INDEX IF NOT EXISTS idx_fact_applied_events_applied_at
					ON fact_applied_events (applied_at)`,
			}); err != nil {
				return err
			}
			log.Println("viewer fact tables migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return execStatements(tx, []string{
				`DROP TABLE IF EXISTS fact_applied_events`,
				`DROP TABLE IF EXISTS fact_values`,
				`DROP TABLE IF EXISTS fact_definitions`,
			})
		},
	}
}
