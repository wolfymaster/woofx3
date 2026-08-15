package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// CreateAlertsTable adds the `alerts` table.
func CreateAlertsTable() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0008_alerts",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Creating alerts table...")
			statements := []string{
				`CREATE TABLE IF NOT EXISTS alerts (
					id              TEXT         NOT NULL PRIMARY KEY,
					application_id  TEXT         NOT NULL REFERENCES applications(id) ON UPDATE CASCADE ON DELETE CASCADE,
					payload         TEXT                                    NOT NULL,
					workflow_id     TEXT,
					source_event_id TEXT         DEFAULT ''                 NOT NULL,
					status          VARCHAR(32)  DEFAULT 'sent'             NOT NULL,
					created_at      TEXT         DEFAULT (datetime('now'))  NOT NULL,
					updated_at      TEXT         DEFAULT (datetime('now'))  NOT NULL
				)`,
				`CREATE INDEX IF NOT EXISTS idx_alerts_application_created_at
					ON alerts (application_id, created_at DESC)`,
				`CREATE INDEX IF NOT EXISTS idx_alerts_workflow_id
					ON alerts (workflow_id) WHERE workflow_id IS NOT NULL`,
			}
			if err := execStatements(tx, statements); err != nil {
				return err
			}
			log.Println("alerts migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`DROP INDEX IF EXISTS idx_alerts_workflow_id`,
				`DROP INDEX IF EXISTS idx_alerts_application_created_at`,
				`DROP TABLE IF EXISTS alerts`,
			}
			if err := execStatements(tx, statements); err != nil {
				return err
			}
			return nil
		},
	}
}
