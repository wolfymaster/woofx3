package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddViewerSegments creates the viewer segment tables. See the postgres
// migration of the same ID for the shape decisions.
//
// Timestamps are DATETIME so the driver returns them as a time.Time.
func AddViewerSegments() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0058_viewer_segments",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Creating viewer segment tables...")
			if err := execStatements(tx, []string{
				`CREATE TABLE IF NOT EXISTS segment_definitions (
					id              TEXT                                NOT NULL PRIMARY KEY,
					name            TEXT                                NOT NULL,
					description     TEXT     DEFAULT ''                 NOT NULL,
					condition       TEXT                                NOT NULL,
					window_kind     TEXT                                NOT NULL CHECK (window_kind IN ('lifetime', 'session')),
					time_relative   BOOLEAN  DEFAULT 0                  NOT NULL,
					stale           BOOLEAN  DEFAULT 0                  NOT NULL,
					revision        INTEGER  DEFAULT 1                  NOT NULL CHECK (revision >= 1),
					created_by_type TEXT     DEFAULT 'USER'             NOT NULL,
					created_by_ref  TEXT     DEFAULT ''                 NOT NULL,
					created_at      DATETIME DEFAULT (datetime('now'))  NOT NULL,
					updated_at      DATETIME DEFAULT (datetime('now'))  NOT NULL
				)`,
				`CREATE TABLE IF NOT EXISTS segment_facts (
					segment_id TEXT NOT NULL REFERENCES segment_definitions(id) ON UPDATE CASCADE ON DELETE CASCADE,
					fact_id    TEXT NOT NULL REFERENCES fact_definitions(id) ON UPDATE CASCADE ON DELETE RESTRICT,
					PRIMARY KEY (segment_id, fact_id)
				)`,
				`CREATE INDEX IF NOT EXISTS idx_segment_facts_fact
					ON segment_facts (fact_id)`,
				`CREATE TABLE IF NOT EXISTS segment_members (
					segment_id TEXT                                NOT NULL REFERENCES segment_definitions(id) ON UPDATE CASCADE ON DELETE CASCADE,
					platform   TEXT                                NOT NULL,
					subject_id TEXT                                NOT NULL,
					window_key TEXT     DEFAULT ''                 NOT NULL,
					entered_at DATETIME DEFAULT (datetime('now'))  NOT NULL,
					PRIMARY KEY (segment_id, platform, subject_id)
				)`,
				`CREATE INDEX IF NOT EXISTS idx_segment_members_subject
					ON segment_members (platform, subject_id)`,
				`ALTER TABLE worker_events ADD COLUMN IF NOT EXISTS extensions TEXT NULL`,
			}); err != nil {
				return err
			}
			log.Println("viewer segment tables migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return execStatements(tx, []string{
				`ALTER TABLE worker_events DROP COLUMN IF EXISTS extensions`,
				`DROP TABLE IF EXISTS segment_members`,
				`DROP TABLE IF EXISTS segment_facts`,
				`DROP TABLE IF EXISTS segment_definitions`,
			})
		},
	}
}
