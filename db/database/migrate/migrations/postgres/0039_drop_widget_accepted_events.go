package postgres

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// DropWidgetAcceptedEvents removes `widgets.accepted_events`. Scenes are only
// ever sent alerts, and alerts reach alert widgets by name, so nothing reads
// the column; barkloader rejects a manifest that still declares the field.
func DropWidgetAcceptedEvents() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0039_drop_widget_accepted_events",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Dropping widgets.accepted_events...")
			if err := tx.Exec(`ALTER TABLE public.widgets DROP COLUMN IF EXISTS accepted_events`).Error; err != nil {
				return err
			}
			log.Println("Widget accepted_events drop complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return tx.Exec(`ALTER TABLE public.widgets ADD COLUMN IF NOT EXISTS accepted_events JSONB NOT NULL DEFAULT '[]'`).Error
		},
	}
}
