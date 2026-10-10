package postgres

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddWidgetTransitions introduces `widgets.transitions`: the transition
// types a widget declares for its own content (a text widget's typewriter),
// as `[{"id", "label"}]`. A placement may enter or leave with one of these
// as well as with the generic types every widget gets.
//
// Existing rows read as `[]` until their module next registers.
func AddWidgetTransitions() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0059_widget_transitions",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding widgets.transitions...")
			if err := tx.Exec(`ALTER TABLE public.widgets ADD COLUMN IF NOT EXISTS transitions JSONB NOT NULL DEFAULT '[]'`).Error; err != nil {
				return err
			}
			log.Println("Widget transitions migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return tx.Exec(`ALTER TABLE public.widgets DROP COLUMN IF EXISTS transitions`).Error
		},
	}
}
