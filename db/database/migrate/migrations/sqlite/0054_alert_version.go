package sqlite

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddAlertVersion adds `alerts.version`. See the postgres migration of the
// same ID.
func AddAlertVersion() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0054_alert_version",
		Migrate: func(tx *gorm.DB) error {
			return execSQL(tx, `ALTER TABLE alerts ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1`)
		},
		Rollback: func(tx *gorm.DB) error {
			return execSQL(tx, `ALTER TABLE alerts DROP COLUMN IF EXISTS version`)
		},
	}
}
