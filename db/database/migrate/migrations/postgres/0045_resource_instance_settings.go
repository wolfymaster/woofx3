package postgres

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// ResourceInstanceSettings gives a resource instance somewhere to keep what it
// was created with: the values of its kind's `schema` fields -- a counter's
// lifetime and initial value, a timer's duration. The engine stores them
// without interpreting them; the owning module reads them.
func ResourceInstanceSettings() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0045_resource_instance_settings",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding module_resource_instances.settings...")
			return tx.Exec(`ALTER TABLE public.module_resource_instances
				ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb`).Error
		},
		Rollback: func(tx *gorm.DB) error {
			return tx.Exec(`ALTER TABLE public.module_resource_instances DROP COLUMN IF EXISTS settings`).Error
		},
	}
}
