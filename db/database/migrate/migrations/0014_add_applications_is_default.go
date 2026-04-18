package migrations

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddApplicationsIsDefault introduces applications.is_default plus a partial
// unique index enforcing at most one default application at a time. The
// default application is the one the engine resolves to when callers pass
// an empty application_id on their RPCs.
func AddApplicationsIsDefault() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "202604170002_add_applications_is_default",
		Migrate: func(tx *gorm.DB) error {
			if err := tx.Exec(`
				ALTER TABLE public.applications
				ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;
			`).Error; err != nil {
				return err
			}
			return tx.Exec(`
				CREATE UNIQUE INDEX IF NOT EXISTS applications_single_default
				ON public.applications (is_default) WHERE is_default = true;
			`).Error
		},
		Rollback: func(tx *gorm.DB) error {
			if err := tx.Exec(`DROP INDEX IF EXISTS applications_single_default`).Error; err != nil {
				return err
			}
			return tx.Exec(`ALTER TABLE public.applications DROP COLUMN IF EXISTS is_default`).Error
		},
	}
}
