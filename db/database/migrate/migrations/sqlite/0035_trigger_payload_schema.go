package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddTriggerPayloadSchemaColumn introduces a `payload_schema` column on
// triggers. See the postgres migration of the same name for why it is
// separate from config_schema.
func AddTriggerPayloadSchemaColumn() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0035_trigger_payload_schema",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding payload_schema column to triggers table...")
			stmt := `ALTER TABLE triggers
				ADD COLUMN IF NOT EXISTS payload_schema TEXT NOT NULL DEFAULT '{}'`
			if err := execSQL(tx, stmt); err != nil {
				return err
			}
			log.Println("Trigger payload_schema column migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return execSQL(tx, `ALTER TABLE triggers DROP COLUMN IF EXISTS payload_schema`)
		},
	}
}
