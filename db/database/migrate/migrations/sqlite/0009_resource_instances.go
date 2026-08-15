package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// CreateModuleResourceInstancesTable adds the `module_resource_instances` table.
func CreateModuleResourceInstancesTable() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0009_resource_instances",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Creating module_resource_instances table...")
			statements := []string{
				`CREATE TABLE IF NOT EXISTS module_resource_instances (
					id            TEXT         NOT NULL PRIMARY KEY,
					module_id     TEXT         NOT NULL REFERENCES modules(id) ON UPDATE CASCADE ON DELETE CASCADE,
					kind          TEXT                                    NOT NULL,
					instance_id   TEXT                                    NOT NULL,
					display_name  TEXT         DEFAULT ''                 NOT NULL,
					created_at    TEXT         DEFAULT (datetime('now'))  NOT NULL,
					updated_at    TEXT         DEFAULT (datetime('now'))  NOT NULL
				)`,
				`CREATE INDEX IF NOT EXISTS idx_mri_module_id
					ON module_resource_instances (module_id)`,
				`CREATE INDEX IF NOT EXISTS idx_mri_kind
					ON module_resource_instances (kind)`,
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_mri_module_kind_instance
					ON module_resource_instances (module_id, kind, instance_id)`,
			}
			if err := execStatements(tx, statements); err != nil {
				return err
			}
			log.Println("module_resource_instances migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`DROP INDEX IF EXISTS idx_mri_module_kind_instance`,
				`DROP INDEX IF EXISTS idx_mri_kind`,
				`DROP INDEX IF EXISTS idx_mri_module_id`,
				`DROP TABLE IF EXISTS module_resource_instances`,
			}
			if err := execStatements(tx, statements); err != nil {
				return err
			}
			return nil
		},
	}
}
