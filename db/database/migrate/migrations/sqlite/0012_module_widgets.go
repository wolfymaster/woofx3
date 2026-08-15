package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

func CreateModuleWidgetsTable() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0012_module_widgets",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Creating module_widgets table...")
			statements := []string{
				`CREATE TABLE IF NOT EXISTS module_widgets (
					id              TEXT        NOT NULL PRIMARY KEY,
					name            TEXT                                   NOT NULL,
					description     TEXT        DEFAULT ''                 NOT NULL,
					directory       TEXT                                   NOT NULL,
					alert_types     TEXT        DEFAULT '[]'               NOT NULL,
					settings_schema TEXT        DEFAULT '[]'               NOT NULL,
					surface         TEXT        DEFAULT 'scene'            NOT NULL,
					created_by_type TEXT        DEFAULT 'MODULE'           NOT NULL,
					created_by_ref  TEXT        DEFAULT ''                 NOT NULL,
					manifest_id     TEXT        DEFAULT ''                 NOT NULL,
					created_at      TEXT        DEFAULT (datetime('now'))  NOT NULL,
					updated_at      TEXT        DEFAULT (datetime('now'))  NOT NULL
				)`,
				`CREATE INDEX IF NOT EXISTS idx_module_widgets_origin
					ON module_widgets (created_by_type, created_by_ref)`,
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_module_widgets_origin_manifest
					ON module_widgets (created_by_type, created_by_ref, manifest_id)`,
			}
			if err := execStatements(tx, statements); err != nil {
				return err
			}
			log.Println("module_widgets migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`DROP INDEX IF EXISTS idx_module_widgets_origin_manifest`,
				`DROP INDEX IF EXISTS idx_module_widgets_origin`,
				`DROP TABLE IF EXISTS module_widgets`,
			}
			if err := execStatements(tx, statements); err != nil {
				return err
			}
			return nil
		},
	}
}
