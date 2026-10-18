package postgres

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddCommandWorkflow introduces `commands.workflow_id`: the stored workflow a
// command runs. Null for every existing row; db-proxy links each command that
// has actions to a workflow of its own when it starts (see
// services.LinkCommandWorkflows), so the link is made where the outbox can
// announce the new workflow, and a command that fails to link keeps running
// its actions as before.
//
// db-proxy refuses to delete a command's workflow except through the command.
// The foreign key is the backstop for anything that deletes the row anyway:
// the command is left with no workflow rather than a link to nothing.
func AddCommandWorkflow() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0064_command_workflow",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding commands.workflow_id...")
			if err := tx.Exec(`ALTER TABLE public.commands ADD COLUMN IF NOT EXISTS workflow_id UUID
				REFERENCES public.workflow_definitions(id) ON DELETE SET NULL`).Error; err != nil {
				return err
			}
			log.Println("Command workflow migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return tx.Exec(`ALTER TABLE public.commands DROP COLUMN IF EXISTS workflow_id`).Error
		},
	}
}
