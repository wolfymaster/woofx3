package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddWorkflowGroups creates alert groups. See the postgres migration of the
// same ID.
func AddWorkflowGroups() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0079_workflow_groups",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Creating workflow_groups, workflow_group_members...")
			if err := execStatements(tx, []string{
				`CREATE TABLE IF NOT EXISTS workflow_groups (
					id          TEXT         NOT NULL PRIMARY KEY,
					name        VARCHAR(100) NOT NULL,
					description VARCHAR(500) NOT NULL DEFAULT '',
					enabled     BOOLEAN      NOT NULL DEFAULT 0,
					created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
					updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
					CONSTRAINT uq_workflow_groups_name UNIQUE (name)
				)`,
				`CREATE TABLE IF NOT EXISTS workflow_group_members (
					group_id    TEXT     NOT NULL REFERENCES workflow_groups(id) ON DELETE CASCADE,
					workflow_id TEXT     NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
					created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
					PRIMARY KEY (group_id, workflow_id)
				)`,
				`CREATE INDEX IF NOT EXISTS idx_workflow_group_members_workflow_id ON workflow_group_members (workflow_id)`,
				`ALTER TABLE workflow_definitions ADD COLUMN IF NOT EXISTS pre_group_enabled BOOLEAN NULL`,
			}); err != nil {
				return err
			}
			log.Println("workflow_groups migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return execStatements(tx, []string{
				`ALTER TABLE workflow_definitions DROP COLUMN IF EXISTS pre_group_enabled`,
				`DROP TABLE IF EXISTS workflow_group_members`,
				`DROP TABLE IF EXISTS workflow_groups`,
			})
		},
	}
}
