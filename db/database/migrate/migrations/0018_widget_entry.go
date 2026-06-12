package migrations

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddWidgetEntryColumn adds `entry` to the widgets table — the entry
// document path relative to the widget asset root. Empty means the
// frame assembler falls back to "index.html". Normalization (prefix
// stripping, traversal rejection) happens at registration time in
// barkloader; the engine persists the normalized value verbatim.
func AddWidgetEntryColumn() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0018_widget_entry",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding entry column to widgets table...")
			statements := []string{
				`ALTER TABLE public.widgets
					ADD COLUMN IF NOT EXISTS entry TEXT NOT NULL DEFAULT ''`,
			}
			for _, stmt := range statements {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			log.Println("widgets entry column migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`ALTER TABLE public.widgets DROP COLUMN IF EXISTS entry`,
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
