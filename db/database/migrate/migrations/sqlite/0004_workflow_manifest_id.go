package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddWorkflowManifestIDColumn adds the `manifest_id` column to
// `workflow_definitions`.
func AddWorkflowManifestIDColumn() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0004_workflow_manifest_id",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding manifest_id column to workflow_definitions...")
			statements := []string{
				`ALTER TABLE workflow_definitions
					ADD COLUMN IF NOT EXISTS manifest_id TEXT NOT NULL DEFAULT ''`,
				`CREATE INDEX IF NOT EXISTS idx_workflow_definitions_creator_manifest_id
					ON workflow_definitions (created_by_type, created_by_ref, manifest_id)`,
			}
			if err := execStatements(tx, statements); err != nil {
				return err
			}
			log.Println("workflow_definitions.manifest_id migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`DROP INDEX IF EXISTS idx_workflow_definitions_creator_manifest_id`,
				`ALTER TABLE workflow_definitions DROP COLUMN IF EXISTS manifest_id`,
			}
			if err := execStatements(tx, statements); err != nil {
				return err
			}
			return nil
		},
	}
}
