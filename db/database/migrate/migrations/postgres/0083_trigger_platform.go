package postgres

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddTriggerPlatform introduces `triggers.platform`: the platform whose
// events alone fire the trigger (a manifest trigger's `platform`). Empty means
// any platform, which every existing row reads as until its module next
// registers.
func AddTriggerPlatform() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0083_trigger_platform",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding triggers.platform...")
			if err := tx.Exec(`ALTER TABLE public.triggers ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT ''`).Error; err != nil {
				return err
			}
			log.Println("Trigger platform migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return tx.Exec(`ALTER TABLE public.triggers DROP COLUMN IF EXISTS platform`).Error
		},
	}
}
