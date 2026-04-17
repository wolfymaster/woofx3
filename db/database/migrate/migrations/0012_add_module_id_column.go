package migrations

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

func AddModuleKeyColumn() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "202604150005_add_module_key_column",
		Migrate: func(tx *gorm.DB) error {
			// Drop leftover module_id column if it exists from a prior run
			if err := tx.Exec(`
				ALTER TABLE public.modules
					DROP COLUMN IF EXISTS module_id;
			`).Error; err != nil {
				return err
			}

			// Add module_key column (nullable initially for backfill)
			if err := tx.Exec(`
				ALTER TABLE public.modules
					ADD COLUMN IF NOT EXISTS module_key TEXT;
			`).Error; err != nil {
				return err
			}

			// Backfill existing rows: use name:version as a placeholder
			// (the real hash requires the zip bytes which are not available in a migration)
			if err := tx.Exec(`
				UPDATE public.modules
				SET module_key = name || ':' || version || ':0000000'
				WHERE module_key IS NULL OR module_key = '';
			`).Error; err != nil {
				return err
			}

			// Now make it NOT NULL
			if err := tx.Exec(`
				ALTER TABLE public.modules
					ALTER COLUMN module_key SET NOT NULL;
			`).Error; err != nil {
				return err
			}

			// Add unique index
			if err := tx.Exec(`
				CREATE UNIQUE INDEX IF NOT EXISTS idx_modules_module_key ON public.modules (module_key);
			`).Error; err != nil {
				return err
			}

			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return tx.Exec(`
				ALTER TABLE public.modules DROP COLUMN IF EXISTS module_key;
			`).Error
		},
	}
}
