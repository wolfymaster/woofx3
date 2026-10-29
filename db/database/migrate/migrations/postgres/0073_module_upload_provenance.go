package postgres

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddModuleUploadProvenance records which stored resource a module was
// installed from: `modules.upload_resource_id`, the id of a module archive
// the user uploaded. A module installed from one keeps the resource from
// being deleted while it is installed.
//
// Nullable with no default and no foreign key: NULL means the module did not
// come from an upload. The resource cannot be deleted while a row names it,
// which db-proxy enforces when deleting, so no row ever names a missing one.
func AddModuleUploadProvenance() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0073_module_upload_provenance",
		Migrate: func(tx *gorm.DB) error {
			for _, stmt := range []string{
				`ALTER TABLE public.modules ADD COLUMN IF NOT EXISTS upload_resource_id TEXT`,
				`CREATE INDEX IF NOT EXISTS idx_modules_upload_resource_id ON public.modules (upload_resource_id)`,
			} {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			for _, stmt := range []string{
				`DROP INDEX IF EXISTS public.idx_modules_upload_resource_id`,
				`ALTER TABLE public.modules DROP COLUMN IF EXISTS upload_resource_id`,
			} {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			return nil
		},
	}
}
