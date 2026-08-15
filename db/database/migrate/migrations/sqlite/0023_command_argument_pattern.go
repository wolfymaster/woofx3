package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddCommandArgumentPatternColumn adds commands.argument_pattern.
func AddCommandArgumentPatternColumn() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0023_command_argument_pattern",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding commands.argument_pattern column...")
			stmt := `ALTER TABLE commands ADD COLUMN IF NOT EXISTS argument_pattern VARCHAR(255) NOT NULL DEFAULT ''`
			if err := execSQL(tx, stmt); err != nil {
				return err
			}
			log.Println("commands.argument_pattern column added")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return execSQL(tx, `ALTER TABLE commands DROP COLUMN IF EXISTS argument_pattern`)
		},
	}
}
