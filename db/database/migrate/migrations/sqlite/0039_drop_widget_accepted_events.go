package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// DropWidgetAcceptedEvents removes `widgets.accepted_events`. See the
// postgres migration of the same name for the rationale.
func DropWidgetAcceptedEvents() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0039_drop_widget_accepted_events",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Dropping widgets.accepted_events...")
			if err := execSQL(tx, `ALTER TABLE widgets DROP COLUMN IF EXISTS accepted_events`); err != nil {
				return err
			}
			log.Println("Widget accepted_events drop complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return execSQL(tx, `ALTER TABLE widgets ADD COLUMN IF NOT EXISTS accepted_events TEXT NOT NULL DEFAULT '[]'`)
		},
	}
}
