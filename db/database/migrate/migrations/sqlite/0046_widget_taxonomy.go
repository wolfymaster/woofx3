package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddWidgetTaxonomy introduces `widgets.taxonomy`. See the postgres
// migration of the same name for the full rationale.
func AddWidgetTaxonomy() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0046_widget_taxonomy",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding widgets.taxonomy...")
			if err := execSQL(tx, `ALTER TABLE widgets ADD COLUMN IF NOT EXISTS taxonomy TEXT NOT NULL DEFAULT '[]'`); err != nil {
				return err
			}
			log.Println("Widget taxonomy migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return execSQL(tx, `ALTER TABLE widgets DROP COLUMN IF EXISTS taxonomy`)
		},
	}
}
