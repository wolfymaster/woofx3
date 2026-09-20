package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddTriggerSentence introduces `triggers.sentence`. See the postgres
// migration of the same name for the full rationale.
func AddTriggerSentence() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0043_trigger_sentence",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding triggers.sentence...")
			if err := execSQL(tx, `ALTER TABLE triggers ADD COLUMN IF NOT EXISTS sentence TEXT NOT NULL DEFAULT ''`); err != nil {
				return err
			}
			log.Println("Trigger sentence migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return execSQL(tx, `ALTER TABLE triggers DROP COLUMN IF EXISTS sentence`)
		},
	}
}
