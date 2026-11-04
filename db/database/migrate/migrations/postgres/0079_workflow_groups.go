package postgres

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddWorkflowGroups creates alert groups: named sets of workflows switched on
// and off together. workflow_definitions.enabled stays the only switch the
// runtime reads; pre_group_enabled is the state a workflow goes back to when
// the last group that is on lets go of it, and is NULL while no group that is
// on contains it.
func AddWorkflowGroups() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0079_workflow_groups",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Creating workflow_groups, workflow_group_members...")
			statements := []string{
				`CREATE TABLE IF NOT EXISTS public.workflow_groups (
					id          UUID         NOT NULL PRIMARY KEY,
					name        VARCHAR(100) NOT NULL,
					description VARCHAR(500) NOT NULL DEFAULT '',
					enabled     BOOLEAN      NOT NULL DEFAULT FALSE,
					created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
					updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
					CONSTRAINT uq_workflow_groups_name UNIQUE (name)
				)`,
				`CREATE TABLE IF NOT EXISTS public.workflow_group_members (
					group_id    UUID        NOT NULL REFERENCES public.workflow_groups(id) ON DELETE CASCADE,
					workflow_id UUID        NOT NULL REFERENCES public.workflow_definitions(id) ON DELETE CASCADE,
					created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
					PRIMARY KEY (group_id, workflow_id)
				)`,
				`CREATE INDEX IF NOT EXISTS idx_workflow_group_members_workflow_id ON public.workflow_group_members (workflow_id)`,
				`ALTER TABLE public.workflow_definitions ADD COLUMN IF NOT EXISTS pre_group_enabled BOOLEAN NULL`,
			}
			for _, stmt := range statements {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			log.Println("workflow_groups migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`ALTER TABLE public.workflow_definitions DROP COLUMN IF EXISTS pre_group_enabled`,
				`DROP TABLE IF EXISTS public.workflow_group_members`,
				`DROP TABLE IF EXISTS public.workflow_groups`,
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
