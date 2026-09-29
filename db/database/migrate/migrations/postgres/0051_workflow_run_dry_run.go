package postgres

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddWorkflowRunDryRun marks the recorded runs that were dry runs: the engine
// recorded what each side-effecting step would have done instead of doing it.
// A run history that mixed the two without saying which would show a chat
// message as sent that never was.
//
// NOT NULL DEFAULT false, so every run recorded before this migration reads
// as the real run it was.
func AddWorkflowRunDryRun() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0051_workflow_run_dry_run",
		Migrate: func(tx *gorm.DB) error {
			return tx.Exec(`ALTER TABLE public.workflow_executions ADD COLUMN IF NOT EXISTS dry_run BOOLEAN NOT NULL DEFAULT false`).Error
		},
		Rollback: func(tx *gorm.DB) error {
			return tx.Exec(`ALTER TABLE public.workflow_executions DROP COLUMN IF EXISTS dry_run`).Error
		},
	}
}
