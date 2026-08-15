package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddModuleResourcesUniqueConstraint adds a UNIQUE index on
// module_resources (module_id, resource_type, manifest_id).
func AddModuleResourcesUniqueConstraint() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0028_module_resources_unique",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Deduplicating module_resources before adding unique constraint...")
			statements := []string{
				`DELETE FROM module_resources
					WHERE id IN (
						SELECT mr.id
						FROM module_resources mr
						INNER JOIN module_resources newer
							ON mr.module_id = newer.module_id
							AND mr.resource_type = newer.resource_type
							AND mr.manifest_id = newer.manifest_id
						WHERE mr.updated_at < newer.updated_at
						   OR (mr.updated_at = newer.updated_at AND mr.id < newer.id)
					)`,
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_module_resources_unique
					ON module_resources (module_id, resource_type, manifest_id)`,
			}
			if err := execStatements(tx, statements); err != nil {
				return err
			}
			log.Println("module_resources unique constraint migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return tx.Exec(`DROP INDEX IF EXISTS idx_module_resources_unique`).Error
		},
	}
}
