package migrations

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddCommandArgumentPatternColumn adds commands.argument_pattern, which
// declares "{variable}" placeholders a command accepts as named arguments
// (e.g. "{songTitle}" or "{userA} {userB}"). `command` itself stays the bare
// trigger word - this column is parsed separately by woofwoofwoof at match
// time so the Casbin resource key ("command/"+commands.command) and the
// in-memory chat trigger word never contain braces.
func AddCommandArgumentPatternColumn() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0023_command_argument_pattern",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding commands.argument_pattern column...")
			stmt := `ALTER TABLE public.commands ADD COLUMN IF NOT EXISTS argument_pattern VARCHAR(255) NOT NULL DEFAULT ''`
			if err := tx.Exec(stmt).Error; err != nil {
				return err
			}
			log.Println("commands.argument_pattern column added")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return tx.Exec(`ALTER TABLE public.commands DROP COLUMN IF EXISTS argument_pattern`).Error
		},
	}
}
