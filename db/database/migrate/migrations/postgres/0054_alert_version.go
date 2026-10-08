package postgres

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddAlertVersion adds `alerts.version`, a counter the database increments on
// every write to the row that is published.
//
// Each lifecycle write publishes the row, and receivers get those callbacks
// retried independently and out of order. The version is how a receiver tells
// the newer of two snapshots apart: unlike `updated_at`, two writes can never
// share one, and it follows the order the writes were applied in.
//
// Existing rows start at 1, the version of a freshly created row.
func AddAlertVersion() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0054_alert_version",
		Migrate: func(tx *gorm.DB) error {
			return tx.Exec(`ALTER TABLE public.alerts ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 1`).Error
		},
		Rollback: func(tx *gorm.DB) error {
			return tx.Exec(`ALTER TABLE public.alerts DROP COLUMN IF EXISTS version`).Error
		},
	}
}
