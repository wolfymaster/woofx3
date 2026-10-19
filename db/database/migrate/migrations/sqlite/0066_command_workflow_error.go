package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddCommandWorkflowError introduces `commands.workflow_error`. See the
// postgres migration of the same name for the full rationale.
func AddCommandWorkflowError() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0066_command_workflow_error",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding commands.workflow_error...")
			return execSQL(tx, `ALTER TABLE commands ADD COLUMN IF NOT EXISTS workflow_error TEXT NOT NULL DEFAULT ''`)
		},
		Rollback: func(tx *gorm.DB) error {
			return execSQL(tx, `ALTER TABLE commands DROP COLUMN IF EXISTS workflow_error`)
		},
	}
}
