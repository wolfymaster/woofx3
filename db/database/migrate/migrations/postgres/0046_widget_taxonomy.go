package postgres

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddWidgetTaxonomy introduces `widgets.taxonomy`: the open, multi-valued
// dotted classification triggers, actions, workflows and modules already
// carry, extended to widgets so a catalog can group them by what they are
// (`media.video`, `text`) rather than by which module shipped them.
//
// Existing rows read as `[]` until their module next registers. A widget
// with no taxonomy is not an error — the UI groups those separately.
func AddWidgetTaxonomy() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0046_widget_taxonomy",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding widgets.taxonomy...")
			if err := tx.Exec(`ALTER TABLE public.widgets ADD COLUMN IF NOT EXISTS taxonomy JSONB NOT NULL DEFAULT '[]'`).Error; err != nil {
				return err
			}
			log.Println("Widget taxonomy migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return tx.Exec(`ALTER TABLE public.widgets DROP COLUMN IF EXISTS taxonomy`).Error
		},
	}
}
