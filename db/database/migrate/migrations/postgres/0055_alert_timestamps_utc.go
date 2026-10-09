package postgres

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// NormaliseAlertTimestamps has nothing to do on Postgres, where the alert
// timestamps are TIMESTAMPTZ and compare as instants. It exists so both
// dialects share one migration history; the SQLite migration of the same ID
// does the work.
func NormaliseAlertTimestamps() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0055_alert_timestamps_utc",
		Migrate: func(tx *gorm.DB) error {
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return nil
		},
	}
}
