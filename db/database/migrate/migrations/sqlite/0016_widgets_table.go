package sqlite

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
			if err := renameTableIfNeeded(tx, "module_widgets", "widgets"); err != nil {
				return err
			}
			statements := []string{
				`ALTER TABLE widgets ADD COLUMN IF NOT EXISTS application_id TEXT NOT NULL DEFAULT ''`,
				`DROP INDEX IF EXISTS idx_module_widgets_origin`,
				`DROP INDEX IF EXISTS idx_module_widgets_origin_manifest`,
				`CREATE INDEX IF NOT EXISTS idx_widgets_origin
					ON widgets (created_by_type, created_by_ref)`,
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_widgets_origin_manifest
					ON widgets (created_by_type, created_by_ref, manifest_id)`,
				`CREATE INDEX IF NOT EXISTS idx_widgets_application_id
					ON widgets (application_id)`,
			}
			if err := execStatements(tx, statements); err != nil {
				return err
			}
			log.Println("widgets table migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`DROP INDEX IF EXISTS idx_widgets_application_id`,
				`DROP INDEX IF EXISTS idx_widgets_origin_manifest`,
				`DROP INDEX IF EXISTS idx_widgets_origin`,
				`ALTER TABLE widgets DROP COLUMN IF EXISTS application_id`,
			}
			if err := execStatements(tx, statements); err != nil {
				return err
			}
			if err := renameTableIfNeeded(tx, "widgets", "module_widgets"); err != nil {
				return err
			}
			postStatements := []string{
				`CREATE INDEX IF NOT EXISTS idx_module_widgets_origin
					ON module_widgets (created_by_type, created_by_ref)`,
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_module_widgets_origin_manifest
					ON module_widgets (created_by_type, created_by_ref, manifest_id)`,
			}
			if err := execStatements(tx, postStatements); err != nil {
				return err
			}
			return nil
		},
	}
}
