package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddTriggerPlatform introduces `triggers.platform`. See the postgres
// migration of the same name for the full rationale.
func AddTriggerPlatform() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0083_trigger_platform",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding triggers.platform...")
			if err := execSQL(tx, `ALTER TABLE triggers ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT ''`); err != nil {
				return err
			}
			log.Println("Trigger platform migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return execSQL(tx, `ALTER TABLE triggers DROP COLUMN IF EXISTS platform`)
		},
	}
}
