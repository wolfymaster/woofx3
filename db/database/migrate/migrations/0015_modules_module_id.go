package migrations

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddModulesModuleIDColumn adds manifest-local module id (e.g. twitch_platform) to
// modules. Canonical ids and the barkloader sandbox registry key on this value,
// not the display name column.
func AddModulesModuleIDColumn() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0015_modules_module_id",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding modules.module_id column...")
			statements := []string{
				`ALTER TABLE public.modules ADD COLUMN IF NOT EXISTS module_id TEXT NOT NULL DEFAULT ''`,
				// module_key is "{manifestId}:{version}:{hash}"
				`UPDATE public.modules SET module_id = split_part(module_key, ':', 1) WHERE module_id = '' AND module_key <> ''`,
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_modules_module_id ON public.modules (module_id) WHERE module_id <> ''`,
			}
			for _, stmt := range statements {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			log.Println("modules.module_id column added")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`DROP INDEX IF EXISTS idx_modules_module_id`,
				`ALTER TABLE public.modules DROP COLUMN IF EXISTS module_id`,
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
