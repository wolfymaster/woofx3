package sqlite

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddModuleUploadProvenance adds `modules.upload_resource_id`. See the
// postgres migration of the same ID.
func AddModuleUploadProvenance() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0073_module_upload_provenance",
		Migrate: func(tx *gorm.DB) error {
			for _, stmt := range []string{
				`ALTER TABLE modules ADD COLUMN IF NOT EXISTS upload_resource_id TEXT`,
				`CREATE INDEX IF NOT EXISTS idx_modules_upload_resource_id ON modules (upload_resource_id)`,
			} {
				if err := execSQL(tx, stmt); err != nil {
					return err
				}
			}
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			for _, stmt := range []string{
				`DROP INDEX IF EXISTS idx_modules_upload_resource_id`,
				`ALTER TABLE modules DROP COLUMN IF EXISTS upload_resource_id`,
			} {
				if err := execSQL(tx, stmt); err != nil {
					return err
				}
			}
			return nil
		},
	}
}
