package postgres

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddCommandWorkflowError introduces `commands.workflow_error`: why db-proxy
// could not turn a command's actions into a workflow when it linked commands
// to workflows at start (services.LinkCommandWorkflows). Such a command keeps
// running its actions without a workflow, and this is what lets the streamer
// see that and why, rather than only a line in db-proxy's log.
func AddCommandWorkflowError() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0066_command_workflow_error",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding commands.workflow_error...")
			return tx.Exec(`ALTER TABLE public.commands ADD COLUMN IF NOT EXISTS workflow_error TEXT NOT NULL DEFAULT ''`).Error
		},
		Rollback: func(tx *gorm.DB) error {
			return tx.Exec(`ALTER TABLE public.commands DROP COLUMN IF EXISTS workflow_error`).Error
		},
	}
}
