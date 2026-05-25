package migrations

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddApplicationIDColumns introduces an `application_id` column on
// `triggers` and `actions`. Module catalog rows keep the default `''`
// (instance-global). applicationId is carried on workflow/event payloads
// at runtime, not on module resource declarations.
func AddApplicationIDColumns() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0013_application_id_columns",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding application_id columns to triggers / actions...")
			statements := []string{
				`ALTER TABLE public.triggers
					ADD COLUMN IF NOT EXISTS application_id TEXT NOT NULL DEFAULT ''`,
				`ALTER TABLE public.actions
					ADD COLUMN IF NOT EXISTS application_id TEXT NOT NULL DEFAULT ''`,
				`CREATE INDEX IF NOT EXISTS idx_triggers_application_id
					ON public.triggers (application_id)`,
				`CREATE INDEX IF NOT EXISTS idx_actions_application_id
					ON public.actions (application_id)`,
			}
			for _, stmt := range statements {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			log.Println("application_id column migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`DROP INDEX IF EXISTS idx_triggers_application_id`,
				`DROP INDEX IF EXISTS idx_actions_application_id`,
				`ALTER TABLE public.triggers DROP COLUMN IF EXISTS application_id`,
				`ALTER TABLE public.actions DROP COLUMN IF EXISTS application_id`,
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
