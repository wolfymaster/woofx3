package postgres

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddActionSentence introduces `actions.sentence`: the module author's
// one-line English template for a configured step that runs the action, e.g.
// "Add {amount} to {counter}". Every `{fieldId}` names a field in the row's
// params_schema, which barkloader checks at install. An empty string means
// the author declared none, which every existing row reads as until its
// module next registers.
func AddActionSentence() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0063_action_sentence",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding actions.sentence...")
			if err := tx.Exec(`ALTER TABLE public.actions ADD COLUMN IF NOT EXISTS sentence TEXT NOT NULL DEFAULT ''`).Error; err != nil {
				return err
			}
			log.Println("Action sentence migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return tx.Exec(`ALTER TABLE public.actions DROP COLUMN IF EXISTS sentence`).Error
		},
	}
}
