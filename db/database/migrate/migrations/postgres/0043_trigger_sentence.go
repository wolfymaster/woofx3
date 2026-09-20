package postgres

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddTriggerSentence introduces `triggers.sentence`: the module author's
// one-line English template for a configured trigger, e.g.
// "{reward} is redeemed". Every `{fieldId}` names a field in the row's
// config_schema, which barkloader checks at install. An empty string means
// the author declared none, which every existing row reads as until its
// module next registers.
func AddTriggerSentence() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0043_trigger_sentence",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding triggers.sentence...")
			if err := tx.Exec(`ALTER TABLE public.triggers ADD COLUMN IF NOT EXISTS sentence TEXT NOT NULL DEFAULT ''`).Error; err != nil {
				return err
			}
			log.Println("Trigger sentence migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return tx.Exec(`ALTER TABLE public.triggers DROP COLUMN IF EXISTS sentence`).Error
		},
	}
}
