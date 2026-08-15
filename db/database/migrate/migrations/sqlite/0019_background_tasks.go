package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

func CreateBackgroundTasksTable() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0019_background_tasks",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Creating background_tasks table...")
			statements := []string{
				`CREATE TABLE IF NOT EXISTS background_tasks (
					id              TEXT        NOT NULL PRIMARY KEY,
					name            TEXT        DEFAULT ''                 NOT NULL,
					description     TEXT        DEFAULT ''                 NOT NULL,
					function        TEXT                                   NOT NULL,
					schedule        TEXT                                   NOT NULL,
					created_by_type TEXT        DEFAULT 'MODULE'           NOT NULL,
					created_by_ref  TEXT        DEFAULT ''                 NOT NULL,
					manifest_id     TEXT        DEFAULT ''                 NOT NULL,
					application_id  TEXT        DEFAULT ''                 NOT NULL,
					created_at      TEXT        DEFAULT (datetime('now'))  NOT NULL,
					updated_at      TEXT        DEFAULT (datetime('now'))  NOT NULL
				)`,
				`CREATE INDEX IF NOT EXISTS idx_background_tasks_origin
					ON background_tasks (created_by_type, created_by_ref)`,
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_background_tasks_origin_manifest
					ON background_tasks (created_by_type, created_by_ref, manifest_id)`,
			}
			if err := execStatements(tx, statements); err != nil {
				return err
			}
			log.Println("background_tasks migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`DROP INDEX IF EXISTS idx_background_tasks_origin_manifest`,
				`DROP INDEX IF EXISTS idx_background_tasks_origin`,
				`DROP TABLE IF EXISTS background_tasks`,
			}
			if err := execStatements(tx, statements); err != nil {
				return err
			}
			return nil
		},
	}
}
