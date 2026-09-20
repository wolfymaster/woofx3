package sqlite

import (
	"fmt"
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/wolfymaster/woofx3/db/database/migrate/migrations/commandactions"
	"gorm.io/gorm"
)

// CommandActions is the sqlite half of the postgres migration of the same name:
// a command runs an ordered list of actions rather than carrying a type and one
// type-discriminated value.
func CommandActions() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0044_command_actions",
		Migrate: func(tx *gorm.DB) error {
			// See the postgres migration: a replay after a partly applied run
			// finds the legacy columns already gone.
			hasLegacy, err := columnExists(tx, "commands", "type")
			if err != nil {
				return err
			}
			hasActions, err := columnExists(tx, "commands", "actions")
			if err != nil {
				return err
			}
			if !hasLegacy && !hasActions {
				return fmt.Errorf(
					"commands has neither type nor actions: nothing left to say what its commands used to do",
				)
			}

			if err := execSQL(
				tx,
				`ALTER TABLE commands ADD COLUMN IF NOT EXISTS actions TEXT NOT NULL DEFAULT '[]'`,
			); err != nil {
				return err
			}

			if hasLegacy {
				log.Println("Converting commands to action lists...")
				converted, err := commandactions.Convert(tx, "commands")
				if err != nil {
					return err
				}
				log.Printf("Converted %d command row(s) to action lists", converted)
			} else {
				log.Println("Commands already carry action lists; skipping the rewrite")
			}

			return execStatements(tx, []string{
				`ALTER TABLE commands DROP COLUMN IF EXISTS type`,
				`ALTER TABLE commands DROP COLUMN IF EXISTS type_value`,
			})
		},
		Rollback: func(tx *gorm.DB) error {
			// Not reversible; see the postgres migration.
			return nil
		},
	}
}
