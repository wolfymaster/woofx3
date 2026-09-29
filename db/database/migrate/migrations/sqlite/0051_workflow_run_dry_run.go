package sqlite

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddWorkflowRunDryRun adds `workflow_executions.dry_run`. See the postgres
// migration of the same ID.
func AddWorkflowRunDryRun() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0051_workflow_run_dry_run",
		Migrate: func(tx *gorm.DB) error {
			return execSQL(tx, `ALTER TABLE workflow_executions ADD COLUMN IF NOT EXISTS dry_run BOOLEAN NOT NULL DEFAULT 0`)
		},
		Rollback: func(tx *gorm.DB) error {
			return execSQL(tx, `ALTER TABLE workflow_executions DROP COLUMN IF EXISTS dry_run`)
		},
	}
}
