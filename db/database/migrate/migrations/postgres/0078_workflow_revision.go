package postgres

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddWorkflowRevision adds the counter that lets a save made from an older
// copy of a workflow's steps be refused.
func AddWorkflowRevision() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0078_workflow_revision",
		Migrate: func(tx *gorm.DB) error {
			return tx.Exec(`ALTER TABLE public.workflow_definitions
				ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1`).Error
		},
		Rollback: func(tx *gorm.DB) error {
			return tx.Exec(`ALTER TABLE public.workflow_definitions DROP COLUMN IF EXISTS revision`).Error
		},
	}
}
