package sqlite

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddAlertCompositionSnapshot adds `alerts.composition_id`,
// `composition_version` and `snapshot_json`. See the postgres migration of
// the same ID.
func AddAlertCompositionSnapshot() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0062_alert_composition_snapshot",
		Migrate: func(tx *gorm.DB) error {
			return execStatements(tx, []string{
				`ALTER TABLE alerts ADD COLUMN IF NOT EXISTS composition_id TEXT NOT NULL DEFAULT ''`,
				`ALTER TABLE alerts ADD COLUMN IF NOT EXISTS composition_version TEXT NOT NULL DEFAULT ''`,
				`ALTER TABLE alerts ADD COLUMN IF NOT EXISTS snapshot_json TEXT`,
			})
		},
		Rollback: func(tx *gorm.DB) error {
			return execStatements(tx, []string{
				`ALTER TABLE alerts DROP COLUMN IF EXISTS snapshot_json`,
				`ALTER TABLE alerts DROP COLUMN IF EXISTS composition_version`,
				`ALTER TABLE alerts DROP COLUMN IF EXISTS composition_id`,
			})
		},
	}
}
