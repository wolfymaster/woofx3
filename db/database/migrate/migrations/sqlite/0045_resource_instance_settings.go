package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// ResourceInstanceSettings is the sqlite half of the postgres migration of the
// same name.
func ResourceInstanceSettings() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0045_resource_instance_settings",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding module_resource_instances.settings...")
			return tx.Exec(
				`ALTER TABLE module_resource_instances ADD COLUMN IF NOT EXISTS settings TEXT NOT NULL DEFAULT '{}'`,
			).Error
		},
		Rollback: func(tx *gorm.DB) error {
			return tx.Exec(`ALTER TABLE module_resource_instances DROP COLUMN IF EXISTS settings`).Error
		},
	}
}
