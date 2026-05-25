package migrations

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// RenameModuleWidgetsToWidgets converges the widget registry table name
// with triggers/actions (module_widgets → widgets) and adds
// application_id for parity with those extension surfaces.
func RenameModuleWidgetsToWidgets() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0016_widgets_table",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Renaming module_widgets → widgets and adding application_id...")
			statements := []string{
				`DO $$
				BEGIN
					IF EXISTS (
						SELECT 1 FROM information_schema.tables
						WHERE table_schema = 'public' AND table_name = 'module_widgets'
					) AND NOT EXISTS (
						SELECT 1 FROM information_schema.tables
						WHERE table_schema = 'public' AND table_name = 'widgets'
					) THEN
						ALTER TABLE public.module_widgets RENAME TO widgets;
					END IF;
				END
				$$`,
				`ALTER TABLE public.widgets
					ADD COLUMN IF NOT EXISTS application_id TEXT NOT NULL DEFAULT ''`,
				`DROP INDEX IF EXISTS public.idx_module_widgets_origin`,
				`DROP INDEX IF EXISTS public.idx_module_widgets_origin_manifest`,
				`CREATE INDEX IF NOT EXISTS idx_widgets_origin
					ON public.widgets (created_by_type, created_by_ref)`,
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_widgets_origin_manifest
					ON public.widgets (created_by_type, created_by_ref, manifest_id)`,
				`CREATE INDEX IF NOT EXISTS idx_widgets_application_id
					ON public.widgets (application_id)`,
			}
			for _, stmt := range statements {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			log.Println("widgets table migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`DROP INDEX IF EXISTS idx_widgets_application_id`,
				`DROP INDEX IF EXISTS idx_widgets_origin_manifest`,
				`DROP INDEX IF EXISTS idx_widgets_origin`,
				`ALTER TABLE public.widgets DROP COLUMN IF EXISTS application_id`,
				`DO $$
				BEGIN
					IF EXISTS (
						SELECT 1 FROM information_schema.tables
						WHERE table_schema = 'public' AND table_name = 'widgets'
					) AND NOT EXISTS (
						SELECT 1 FROM information_schema.tables
						WHERE table_schema = 'public' AND table_name = 'module_widgets'
					) THEN
						ALTER TABLE public.widgets RENAME TO module_widgets;
					END IF;
				END
				$$`,
				`CREATE INDEX IF NOT EXISTS idx_module_widgets_origin
					ON public.module_widgets (created_by_type, created_by_ref)`,
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_module_widgets_origin_manifest
					ON public.module_widgets (created_by_type, created_by_ref, manifest_id)`,
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
