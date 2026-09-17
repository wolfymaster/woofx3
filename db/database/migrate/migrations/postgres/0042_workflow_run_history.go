package postgres

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// CreateWorkflowRunHistory records what a workflow run did, so a run can be read
// back after the process that ran it is gone, and resumed from where it failed.
//
// Until now a run existed only in engine memory. `workflow_executions` rows were
// written by a path nothing consumed and never advanced past 'pending', and
// per-task state was never persisted at all.
//
// Both halves are needed for a resume, not just for display: restarting at the
// step that failed means restoring the trigger event the run started from and
// the outputs of the steps that already succeeded, because those are exactly
// what the remaining steps' expressions resolve against.
//
// `trigger_event` holds the originating CloudEvent verbatim, the same way
// `alerts.payload` holds an alert envelope -- opaque to the database, re-fed to
// the engine unchanged so a replay takes the path the original run took.
func CreateWorkflowRunHistory() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0042_workflow_run_history",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Creating workflow run history...")
			statements := []string{
				`ALTER TABLE public.workflow_executions
					ADD COLUMN IF NOT EXISTS trigger_event JSONB`,
				`ALTER TABLE public.workflow_executions
					ADD COLUMN IF NOT EXISTS triggered_by TEXT`,
				// The history page's only listing read: one application's runs,
				// newest first. The existing single-column indexes cannot serve
				// it without a sort.
				`CREATE INDEX IF NOT EXISTS idx_workflow_executions_app_started_at
					ON public.workflow_executions (application_id, started_at DESC)`,

				`CREATE TABLE IF NOT EXISTS public.workflow_execution_steps (
					id             UUID         DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
					execution_id   UUID                                    NOT NULL REFERENCES public.workflow_executions(id) ON UPDATE CASCADE ON DELETE CASCADE,
					application_id UUID                                    NOT NULL REFERENCES public.applications(id) ON UPDATE CASCADE ON DELETE CASCADE,
					task_id        TEXT                                    NOT NULL,
					name           TEXT         DEFAULT ''                 NOT NULL,
					status         TEXT                                    NOT NULL,
					attempt        INTEGER      DEFAULT 1                  NOT NULL,
					step_index     INTEGER                                 NOT NULL,
					inputs         JSONB,
					outputs        JSONB,
					error          TEXT,
					started_at     TIMESTAMPTZ,
					completed_at   TIMESTAMPTZ,
					duration_ms    BIGINT,
					created_at     TIMESTAMPTZ  DEFAULT NOW()              NOT NULL,
					updated_at     TIMESTAMPTZ  DEFAULT NOW()              NOT NULL,
					CONSTRAINT workflow_execution_steps_attempt_positive
						CHECK (attempt >= 1)
				)`,
				// One row per attempt at a task within a run. Without this, a
				// retried task accumulates duplicate rows and the timeline shows
				// the same step twice with no way to tell which outcome was final.
				// It is also what lets a step be reported twice -- once running,
				// once settled -- as a single row rather than two.
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_execution_steps_attempt
					ON public.workflow_execution_steps (execution_id, task_id, attempt)`,
				// The timeline's only read: every step of one run, in the order
				// that run executed them.
				`CREATE INDEX IF NOT EXISTS idx_workflow_execution_steps_execution_order
					ON public.workflow_execution_steps (execution_id, step_index)`,
			}
			for _, stmt := range statements {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			log.Println("workflow run history migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			// Steps first: they carry the FK into executions.
			statements := []string{
				`DROP TABLE IF EXISTS public.workflow_execution_steps`,
				`DROP INDEX IF EXISTS idx_workflow_executions_app_started_at`,
				`ALTER TABLE public.workflow_executions DROP COLUMN IF EXISTS triggered_by`,
				`ALTER TABLE public.workflow_executions DROP COLUMN IF EXISTS trigger_event`,
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
