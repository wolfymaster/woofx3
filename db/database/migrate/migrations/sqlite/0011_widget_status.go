package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// CreateWidgetStatusTable adds the `widget_status` table.
func CreateWidgetStatusTable() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0011_widget_status",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Creating widget_status table...")
			statements := []string{
				`CREATE TABLE IF NOT EXISTS widget_status (
					id                  TEXT         NOT NULL PRIMARY KEY,
					application_id      TEXT         NOT NULL REFERENCES applications(id) ON UPDATE CASCADE ON DELETE CASCADE,
					module_id           TEXT         DEFAULT ''                 NOT NULL,
					instance_id         TEXT                                    NOT NULL,
					widget_canonical_id TEXT         DEFAULT ''                 NOT NULL,
					key                 TEXT                                    NOT NULL,
					value               TEXT                                    NOT NULL,
					occurred_at         TEXT                                    NOT NULL,
					created_at          TEXT         DEFAULT (datetime('now'))  NOT NULL,
					updated_at          TEXT         DEFAULT (datetime('now'))  NOT NULL,
					CONSTRAINT widget_status_unique UNIQUE (application_id, instance_id, key)
				)`,
				`CREATE INDEX IF NOT EXISTS idx_widget_status_application_module
					ON widget_status (application_id, module_id)`,
				`CREATE INDEX IF NOT EXISTS idx_widget_status_application_canonical
					ON widget_status (application_id, widget_canonical_id)
					WHERE widget_canonical_id <> ''`,
			}
			if err := execStatements(tx, statements); err != nil {
				return err
			}
			log.Println("widget_status migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`DROP INDEX IF EXISTS idx_widget_status_application_canonical`,
				`DROP INDEX IF EXISTS idx_widget_status_application_module`,
				`DROP TABLE IF EXISTS widget_status`,
			}
			if err := execStatements(tx, statements); err != nil {
				return err
			}
			return nil
		},
	}
}
