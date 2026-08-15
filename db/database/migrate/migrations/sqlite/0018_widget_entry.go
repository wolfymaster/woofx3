package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddWidgetEntryColumn adds `entry` to the widgets table.
func AddWidgetEntryColumn() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0018_widget_entry",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding entry column to widgets table...")
			statements := []string{
				`ALTER TABLE widgets ADD COLUMN IF NOT EXISTS entry TEXT NOT NULL DEFAULT ''`,
			}
			if err := execStatements(tx, statements); err != nil {
				return err
			}
			log.Println("widgets entry column migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`ALTER TABLE widgets DROP COLUMN IF EXISTS entry`,
			}
			if err := execStatements(tx, statements); err != nil {
				return err
			}
			return nil
		},
	}
}
