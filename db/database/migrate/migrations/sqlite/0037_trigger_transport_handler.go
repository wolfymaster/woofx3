package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddTriggerTransportHandler introduces `triggers.transport` and
// `triggers.handler`. See the postgres migration of the same name for the
// full rationale.
func AddTriggerTransportHandler() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0037_trigger_transport_handler",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding triggers.transport and triggers.handler...")
			if err := execSQL(tx, `ALTER TABLE triggers ADD COLUMN IF NOT EXISTS transport TEXT NOT NULL DEFAULT 'eventbus'`); err != nil {
				return err
			}
			if err := execSQL(tx, `ALTER TABLE triggers ADD COLUMN IF NOT EXISTS handler TEXT NOT NULL DEFAULT ''`); err != nil {
				return err
			}
			log.Println("Trigger transport/handler migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			if err := execSQL(tx, `ALTER TABLE triggers DROP COLUMN IF EXISTS handler`); err != nil {
				return err
			}
			return execSQL(tx, `ALTER TABLE triggers DROP COLUMN IF EXISTS transport`)
		},
	}
}
