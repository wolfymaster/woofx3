package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddAlertLifecycle widens the `alerts.status` enum and adds lifecycle columns.
func AddAlertLifecycle() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0010_alert_lifecycle",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding alerts lifecycle columns...")
			statements := []string{
				`ALTER TABLE alerts ADD COLUMN IF NOT EXISTS envelope_id TEXT NOT NULL DEFAULT ''`,
				`ALTER TABLE alerts ADD COLUMN IF NOT EXISTS dispatched_at TEXT`,
				`ALTER TABLE alerts ADD COLUMN IF NOT EXISTS played_at TEXT`,
				`ALTER TABLE alerts ADD COLUMN IF NOT EXISTS completed_at TEXT`,
				`ALTER TABLE alerts ADD COLUMN IF NOT EXISTS error TEXT NOT NULL DEFAULT ''`,
				`CREATE INDEX IF NOT EXISTS idx_alerts_envelope_id
					ON alerts (envelope_id)
					WHERE envelope_id <> ''`,
			}
			if err := execStatements(tx, statements); err != nil {
				return err
			}
			log.Println("alerts lifecycle migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`DROP INDEX IF EXISTS idx_alerts_envelope_id`,
				`ALTER TABLE alerts DROP COLUMN IF EXISTS error`,
				`ALTER TABLE alerts DROP COLUMN IF EXISTS completed_at`,
				`ALTER TABLE alerts DROP COLUMN IF EXISTS played_at`,
				`ALTER TABLE alerts DROP COLUMN IF EXISTS dispatched_at`,
				`ALTER TABLE alerts DROP COLUMN IF EXISTS envelope_id`,
			}
			if err := execStatements(tx, statements); err != nil {
				return err
			}
			return nil
		},
	}
}
