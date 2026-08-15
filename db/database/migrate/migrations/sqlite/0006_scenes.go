package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// CreateScenesTable adds the `scenes` table.
func CreateScenesTable() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0006_scenes",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Creating scenes table...")
			statements := []string{
				`CREATE TABLE IF NOT EXISTS scenes (
					id              TEXT         NOT NULL PRIMARY KEY,
					application_id  TEXT         NOT NULL REFERENCES applications(id) ON UPDATE CASCADE ON DELETE CASCADE,
					name            VARCHAR(255) NOT NULL,
					description     TEXT         DEFAULT ''                 NOT NULL,
					widgets_json    TEXT         DEFAULT '[]'               NOT NULL,
					layout_json     TEXT         DEFAULT '{}'               NOT NULL,
					created_by_type TEXT         DEFAULT 'USER'             NOT NULL,
					created_by_ref  TEXT         DEFAULT ''                 NOT NULL,
					created_at      TEXT         DEFAULT (datetime('now'))  NOT NULL,
					updated_at      TEXT         DEFAULT (datetime('now'))  NOT NULL
				)`,
				`CREATE INDEX IF NOT EXISTS idx_scenes_application_id
					ON scenes (application_id)`,
				`CREATE INDEX IF NOT EXISTS idx_scenes_origin
					ON scenes (created_by_type, created_by_ref)`,
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_scenes_application_name
					ON scenes (application_id, name)`,
			}
			if err := execStatements(tx, statements); err != nil {
				return err
			}
			log.Println("scenes migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`DROP INDEX IF EXISTS idx_scenes_application_name`,
				`DROP INDEX IF EXISTS idx_scenes_origin`,
				`DROP INDEX IF EXISTS idx_scenes_application_id`,
				`DROP TABLE IF EXISTS scenes`,
			}
			if err := execStatements(tx, statements); err != nil {
				return err
			}
			return nil
		},
	}
}
