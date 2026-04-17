package migrations

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

func AddResourceOriginColumns() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "202604150001_add_resource_origin_columns",
		Migrate: func(tx *gorm.DB) error {
			// Add created_by_type and created_by_ref to modules
			if err := tx.Exec(`
				ALTER TABLE public.modules
					ADD COLUMN IF NOT EXISTS created_by_type TEXT NOT NULL DEFAULT 'USER',
					ADD COLUMN IF NOT EXISTS created_by_ref  TEXT NOT NULL DEFAULT '';
			`).Error; err != nil {
				return err
			}

			// Add created_by_type and created_by_ref to module_triggers
			if err := tx.Exec(`
				ALTER TABLE public.module_triggers
					ADD COLUMN IF NOT EXISTS created_by_type TEXT NOT NULL DEFAULT 'MODULE',
					ADD COLUMN IF NOT EXISTS created_by_ref  TEXT NOT NULL DEFAULT '';
			`).Error; err != nil {
				return err
			}

			// Add created_by (text) to workflow_definitions (proto defines it, DB was missing it)
			if err := tx.Exec(`
				ALTER TABLE public.workflow_definitions
					ADD COLUMN IF NOT EXISTS created_by      TEXT NOT NULL DEFAULT '',
					ADD COLUMN IF NOT EXISTS created_by_type TEXT NOT NULL DEFAULT 'USER',
					ADD COLUMN IF NOT EXISTS created_by_ref  TEXT NOT NULL DEFAULT '';
			`).Error; err != nil {
				return err
			}

			// Add created_by_type and created_by_ref to commands
			if err := tx.Exec(`
				ALTER TABLE public.commands
					ADD COLUMN IF NOT EXISTS created_by_type TEXT NOT NULL DEFAULT 'USER',
					ADD COLUMN IF NOT EXISTS created_by_ref  TEXT NOT NULL DEFAULT '';
			`).Error; err != nil {
				return err
			}

			// Backfill: commands where created_by starts with 'module:' are MODULE-origin
			if err := tx.Exec(`
				UPDATE public.commands
				SET created_by_type = 'MODULE',
				    created_by_ref  = SUBSTRING(created_by::text FROM 8)
				WHERE created_by::text LIKE 'module:%';
			`).Error; err != nil {
				return err
			}

			// Backfill: workflow_definitions where created_by starts with 'module:' are MODULE-origin
			if err := tx.Exec(`
				UPDATE public.workflow_definitions
				SET created_by_type = 'MODULE',
				    created_by_ref  = SUBSTRING(created_by FROM 8)
				WHERE created_by LIKE 'module:%';
			`).Error; err != nil {
				return err
			}

			// Backfill: module_triggers already reference their module via module_name
			if err := tx.Exec(`
				UPDATE public.module_triggers
				SET created_by_ref = module_name
				WHERE created_by_ref = '';
			`).Error; err != nil {
				return err
			}

			// Indexes for origin lookups
			indexes := []string{
				"CREATE INDEX IF NOT EXISTS idx_modules_origin ON public.modules (created_by_type, created_by_ref)",
				"CREATE INDEX IF NOT EXISTS idx_module_triggers_origin ON public.module_triggers (created_by_type, created_by_ref)",
				"CREATE INDEX IF NOT EXISTS idx_workflow_definitions_origin ON public.workflow_definitions (created_by_type, created_by_ref)",
				"CREATE INDEX IF NOT EXISTS idx_commands_origin ON public.commands (created_by_type, created_by_ref)",
			}

			for _, indexSQL := range indexes {
				if err := tx.Exec(indexSQL).Error; err != nil {
					return err
				}
			}

			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			drops := []string{
				"ALTER TABLE public.modules DROP COLUMN IF EXISTS created_by_type, DROP COLUMN IF EXISTS created_by_ref",
				"ALTER TABLE public.module_triggers DROP COLUMN IF EXISTS created_by_type, DROP COLUMN IF EXISTS created_by_ref",
				"ALTER TABLE public.workflow_definitions DROP COLUMN IF EXISTS created_by, DROP COLUMN IF EXISTS created_by_type, DROP COLUMN IF EXISTS created_by_ref",
				"ALTER TABLE public.commands DROP COLUMN IF EXISTS created_by_type, DROP COLUMN IF EXISTS created_by_ref",
			}

			for _, sql := range drops {
				if err := tx.Exec(sql).Error; err != nil {
					return err
				}
			}

			return nil
		},
	}
}
