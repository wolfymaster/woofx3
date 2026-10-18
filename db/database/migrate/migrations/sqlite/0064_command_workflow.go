package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddCommandWorkflow introduces `commands.workflow_id`. See the postgres
// migration of the same name for the full rationale.
//
// Unlike postgres, workflow_id has no foreign key: SQLite cannot drop a
// column a foreign key uses, so Rollback could not undo it. db-proxy's own
// refusal to delete a command's workflow is the only guard here.
func AddCommandWorkflow() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0064_command_workflow",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding commands.workflow_id...")
			if err := execSQL(tx, `ALTER TABLE commands ADD COLUMN IF NOT EXISTS workflow_id TEXT`); err != nil {
				return err
			}
			log.Println("Command workflow migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return execSQL(tx, `ALTER TABLE commands DROP COLUMN IF EXISTS workflow_id`)
		},
	}
}
