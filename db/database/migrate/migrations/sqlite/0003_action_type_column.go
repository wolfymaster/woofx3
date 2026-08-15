package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddActionTypeColumn introduces a `type` column on `actions`.
func AddActionTypeColumn() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0003_action_type_column",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding type column to actions table...")
			statements := []string{
				`ALTER TABLE actions ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'function'`,
				`CREATE INDEX IF NOT EXISTS idx_actions_type ON actions (type)`,
			}
			if err := execStatements(tx, statements); err != nil {
				return err
			}
			log.Println("Action type column migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`DROP INDEX IF EXISTS idx_actions_type`,
				`ALTER TABLE actions DROP COLUMN IF EXISTS type`,
			}
			if err := execStatements(tx, statements); err != nil {
				return err
			}
			return nil
		},
	}
}
