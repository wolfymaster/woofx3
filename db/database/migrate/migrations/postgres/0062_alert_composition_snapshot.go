package postgres

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddAlertCompositionSnapshot records, on an alert's log row, the stored
// composition a play showed and exactly what it showed.
//
//   - `composition_id` is the alert composition the step named, and
//     `composition_version` identifies the published version that played
//     (a digest of that document). Both are empty for an alert whose step
//     carried its layout inline. `composition_id` is deliberately not a
//     foreign key: the log outlives the composition.
//   - `snapshot_json` is the composition as it played, with the step's
//     inputs bound into it. NULL until the scene manager records it, and for
//     inline alerts, whose payload already holds what they showed. A replay
//     plays the snapshot, so it shows what the original showed even after the
//     composition is edited or deleted.
func AddAlertCompositionSnapshot() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0062_alert_composition_snapshot",
		Migrate: func(tx *gorm.DB) error {
			statements := []string{
				`ALTER TABLE public.alerts ADD COLUMN IF NOT EXISTS composition_id TEXT NOT NULL DEFAULT ''`,
				`ALTER TABLE public.alerts ADD COLUMN IF NOT EXISTS composition_version TEXT NOT NULL DEFAULT ''`,
				`ALTER TABLE public.alerts ADD COLUMN IF NOT EXISTS snapshot_json JSONB`,
			}
			for _, stmt := range statements {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`ALTER TABLE public.alerts DROP COLUMN IF EXISTS snapshot_json`,
				`ALTER TABLE public.alerts DROP COLUMN IF EXISTS composition_version`,
				`ALTER TABLE public.alerts DROP COLUMN IF EXISTS composition_id`,
			}
			for _, stmt := range statements {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			return nil
		},
	}
}
