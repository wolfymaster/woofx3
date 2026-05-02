package migrations

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddWorkflowEnabledColumn adds the `enabled` column to
// `workflow_definitions`. Workflows are inert until something flips this
// flag — `CreateWorkflow` always inserts with `enabled = false`, and the
// workflow service / executor (`workflow/manager.go`,
// `workflow/reconcile.go`) skip rows where `GetEnabled()` is false at
// load time and on hot-reload events. The UI's `setWorkflowEnabled`
// action is the canonical path to toggle the flag.
//
// The composite `(application_id, enabled)` index supports
// `WorkflowRepository.GetByApplicationIDAndEnabled`, which the executor
// calls every startup and every reconcile pass to fetch the per-tenant
// enabled set without a sequential scan.
//
// Existing rows: every workflow already in the table lands as
// `enabled = false` after this migration. That matches the documented
// "workflows are inactive on create" contract; if any pre-existing
// workflow needs to be live again, re-enable it via the UI (or with a
// one-shot SQL UPDATE).
func AddWorkflowEnabledColumn() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0005_workflow_enabled",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding enabled column to workflow_definitions...")
			statements := []string{
				`ALTER TABLE public.workflow_definitions
					ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT FALSE`,
				`CREATE INDEX IF NOT EXISTS idx_workflow_definitions_application_enabled
					ON public.workflow_definitions (application_id, enabled)`,
			}
			for _, stmt := range statements {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			log.Println("workflow_definitions.enabled migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`DROP INDEX IF EXISTS idx_workflow_definitions_application_enabled`,
				`ALTER TABLE public.workflow_definitions DROP COLUMN IF EXISTS enabled`,
			}
			for _, stmt := range statements {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			return nil
		},
	}
}
