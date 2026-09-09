package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddTriggerEmitsAndActionReturns introduces `triggers.emits` and
// `actions.returns` and drops the superseded `actions.output_schema`. See the
// postgres migration of the same name for the full rationale.
func AddTriggerEmitsAndActionReturns() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0035_trigger_emits_action_returns",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding triggers.emits and actions.returns...")
			statements := []string{
				`ALTER TABLE triggers ADD COLUMN IF NOT EXISTS emits TEXT NOT NULL DEFAULT '{}'`,
				`ALTER TABLE actions ADD COLUMN IF NOT EXISTS returns TEXT NOT NULL DEFAULT '{}'`,
				`ALTER TABLE actions DROP COLUMN IF EXISTS output_schema`,
			}
			for _, stmt := range statements {
				if err := execSQL(tx, stmt); err != nil {
					return err
				}
			}
			log.Println("Trigger emits / action returns migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`ALTER TABLE actions ADD COLUMN IF NOT EXISTS output_schema TEXT NOT NULL DEFAULT '[]'`,
				`ALTER TABLE actions DROP COLUMN IF EXISTS returns`,
				`ALTER TABLE triggers DROP COLUMN IF EXISTS emits`,
			}
			for _, stmt := range statements {
				if err := execSQL(tx, stmt); err != nil {
					return err
				}
			}
			return nil
		},
	}
}
