package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddWorkflowEnabledColumn adds the `enabled` column to
// `workflow_definitions`.
func AddWorkflowEnabledColumn() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0005_workflow_enabled",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding enabled column to workflow_definitions...")
			statements := []string{
				`ALTER TABLE workflow_definitions
					ADD COLUMN IF NOT EXISTS enabled INTEGER NOT NULL DEFAULT 0`,
				`CREATE INDEX IF NOT EXISTS idx_workflow_definitions_application_enabled
					ON workflow_definitions (application_id, enabled)`,
			}
			if err := execStatements(tx, statements); err != nil {
				return err
			}
			log.Println("workflow_definitions.enabled migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`DROP INDEX IF EXISTS idx_workflow_definitions_application_enabled`,
				`ALTER TABLE workflow_definitions DROP COLUMN IF EXISTS enabled`,
			}
			if err := execStatements(tx, statements); err != nil {
				return err
			}
			return nil
		},
	}
}
