package postgres

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddWidgetAcceptedEvents introduces `widgets.accepted_events`, the CloudEvent
// types the scene fan-out delivers to a widget's placements.
//
// The manifest always declared them, but install only used them to derive
// `alert_types` and then dropped them, so the scene manager could only read
// them off each placement — and nothing writes them there. Existing rows get
// the empty default and are filled when their module next registers widgets.
func AddWidgetAcceptedEvents() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0036_widget_accepted_events",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding widgets.accepted_events...")
			if err := tx.Exec(`ALTER TABLE public.widgets ADD COLUMN IF NOT EXISTS accepted_events JSONB NOT NULL DEFAULT '[]'`).Error; err != nil {
				return err
			}
			log.Println("Widget accepted_events migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return tx.Exec(`ALTER TABLE public.widgets DROP COLUMN IF EXISTS accepted_events`).Error
		},
	}
}
