package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddWidgetTransitions introduces `widgets.transitions`. See the postgres
// migration of the same name for the full rationale.
func AddWidgetTransitions() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0056_widget_transitions",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding widgets.transitions...")
			if err := execSQL(tx, `ALTER TABLE widgets ADD COLUMN IF NOT EXISTS transitions TEXT NOT NULL DEFAULT '[]'`); err != nil {
				return err
			}
			log.Println("Widget transitions migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return execSQL(tx, `ALTER TABLE widgets DROP COLUMN IF EXISTS transitions`)
		},
	}
}
