package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddWorkflowDefinitionsUniqueConstraint promotes the creator/manifest
// index to a partial UNIQUE index after deduplicating rows.
func AddWorkflowDefinitionsUniqueConstraint() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0026_workflow_definitions_unique",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Deduplicating workflow_definitions before adding unique constraint...")
			statements := []string{
				`DELETE FROM workflow_definitions
					WHERE id IN (
						SELECT wd.id
						FROM workflow_definitions wd
						INNER JOIN workflow_definitions newer
							ON wd.created_by_type = newer.created_by_type
							AND wd.created_by_ref = newer.created_by_ref
							AND wd.manifest_id = newer.manifest_id
						WHERE wd.manifest_id <> ''
						  AND newer.manifest_id <> ''
						  AND (
							wd.updated_at < newer.updated_at
							OR (wd.updated_at = newer.updated_at AND wd.id < newer.id)
						  )
					)`,
				`DROP INDEX IF EXISTS idx_workflow_definitions_creator_manifest_id`,
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_definitions_creator_manifest_id
					ON workflow_definitions (created_by_type, created_by_ref, manifest_id)
					WHERE manifest_id <> ''`,
			}
			if err := execStatements(tx, statements); err != nil {
				return err
			}
			log.Println("workflow_definitions unique constraint migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`DROP INDEX IF EXISTS idx_workflow_definitions_creator_manifest_id`,
				`CREATE INDEX IF NOT EXISTS idx_workflow_definitions_creator_manifest_id
					ON workflow_definitions (created_by_type, created_by_ref, manifest_id)`,
			}
			if err := execStatements(tx, statements); err != nil {
				return err
			}
			return nil
		},
	}
}
