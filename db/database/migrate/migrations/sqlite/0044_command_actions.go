package sqlite

import (
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
			log.Println("Converting commands to action lists...")
			if err := execSQL(
				tx,
				`ALTER TABLE commands ADD COLUMN IF NOT EXISTS actions TEXT NOT NULL DEFAULT '[]'`,
			); err != nil {
				return err
			}

			converted, err := commandactions.Convert(tx, "commands")
			if err != nil {
				return err
			}
			log.Printf("Converted %d command row(s) to action lists", converted)

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
