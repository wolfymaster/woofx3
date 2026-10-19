package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddActionSentence introduces `actions.sentence`. See the postgres
// migration of the same name for the full rationale.
func AddActionSentence() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0063_action_sentence",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding actions.sentence...")
			if err := execSQL(tx, `ALTER TABLE actions ADD COLUMN IF NOT EXISTS sentence TEXT NOT NULL DEFAULT ''`); err != nil {
				return err
			}
			log.Println("Action sentence migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return execSQL(tx, `ALTER TABLE actions DROP COLUMN IF EXISTS sentence`)
		},
	}
}
