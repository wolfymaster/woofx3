package postgres

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddTriggerTransportHandler introduces `triggers.transport` (the manifest
// trigger `type`) and `triggers.handler` (a webhook trigger's handler
// function, as a canonical id). Every existing row is a bus trigger, which the
// defaults describe; rows are refreshed when their module next registers.
func AddTriggerTransportHandler() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0037_trigger_transport_handler",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding triggers.transport and triggers.handler...")
			if err := tx.Exec(`ALTER TABLE public.triggers ADD COLUMN IF NOT EXISTS transport TEXT NOT NULL DEFAULT 'eventbus'`).Error; err != nil {
				return err
			}
			if err := tx.Exec(`ALTER TABLE public.triggers ADD COLUMN IF NOT EXISTS handler TEXT NOT NULL DEFAULT ''`).Error; err != nil {
				return err
			}
			log.Println("Trigger transport/handler migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			if err := tx.Exec(`ALTER TABLE public.triggers DROP COLUMN IF EXISTS handler`).Error; err != nil {
				return err
			}
			return tx.Exec(`ALTER TABLE public.triggers DROP COLUMN IF EXISTS transport`).Error
		},
	}
}
