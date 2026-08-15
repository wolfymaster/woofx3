package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddActionOutputSchemaColumn introduces an `output_schema` column on actions.
func AddActionOutputSchemaColumn() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0025_action_output_schema",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding output_schema column to actions table...")
			stmt := `ALTER TABLE actions
				ADD COLUMN IF NOT EXISTS output_schema TEXT NOT NULL DEFAULT '[]'`
			if err := execSQL(tx, stmt); err != nil {
				return err
			}
			log.Println("Action output_schema column migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return execSQL(tx, `ALTER TABLE actions DROP COLUMN IF EXISTS output_schema`)
		},
	}
}
