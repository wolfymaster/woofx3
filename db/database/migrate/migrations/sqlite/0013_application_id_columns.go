package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddApplicationIDColumns introduces an `application_id` column on
// `triggers` and `actions`.
func AddApplicationIDColumns() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0013_application_id_columns",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding application_id columns to triggers / actions...")
			statements := []string{
				`ALTER TABLE triggers ADD COLUMN IF NOT EXISTS application_id TEXT NOT NULL DEFAULT ''`,
				`ALTER TABLE actions ADD COLUMN IF NOT EXISTS application_id TEXT NOT NULL DEFAULT ''`,
				`CREATE INDEX IF NOT EXISTS idx_triggers_application_id
					ON triggers (application_id)`,
				`CREATE INDEX IF NOT EXISTS idx_actions_application_id
					ON actions (application_id)`,
			}
			if err := execStatements(tx, statements); err != nil {
				return err
			}
			log.Println("application_id column migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`DROP INDEX IF EXISTS idx_triggers_application_id`,
				`DROP INDEX IF EXISTS idx_actions_application_id`,
				`ALTER TABLE triggers DROP COLUMN IF EXISTS application_id`,
				`ALTER TABLE actions DROP COLUMN IF EXISTS application_id`,
			}
			if err := execStatements(tx, statements); err != nil {
				return err
			}
			return nil
		},
	}
}
