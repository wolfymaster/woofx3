package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// CreateWorkflowRunHistory records what a workflow run did. See the postgres
// migration of the same ID for why the trigger event and per-step outputs are
// both needed, rather than only the run's final status.
//
// SQLite has no `uuid_generate_v4()`, so step ids are supplied by the service on
// insert rather than defaulted by the column. `ADD COLUMN IF NOT EXISTS` is
// emulated by execSQL (see helpers.go) because the embedded SQLite build does
// not accept it.
func CreateWorkflowRunHistory() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0042_workflow_run_history",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Creating workflow run history...")
			statements := []string{
				`ALTER TABLE workflow_executions ADD COLUMN IF NOT EXISTS trigger_event TEXT`,
				`ALTER TABLE workflow_executions ADD COLUMN IF NOT EXISTS triggered_by TEXT`,
				`CREATE INDEX IF NOT EXISTS idx_workflow_executions_app_started_at
					ON workflow_executions (application_id, started_at DESC)`,

				`CREATE TABLE IF NOT EXISTS workflow_execution_steps (
					id             TEXT                               NOT NULL PRIMARY KEY,
					execution_id   TEXT                               NOT NULL REFERENCES workflow_executions(id) ON UPDATE CASCADE ON DELETE CASCADE,
					application_id TEXT                               NOT NULL REFERENCES applications(id) ON UPDATE CASCADE ON DELETE CASCADE,
					task_id        TEXT                               NOT NULL,
					name           TEXT     DEFAULT ''                NOT NULL,
					status         TEXT                               NOT NULL,
					attempt        INTEGER  DEFAULT 1                 NOT NULL,
					step_index     INTEGER                            NOT NULL,
					inputs         TEXT,
					outputs        TEXT,
					error          TEXT,
					started_at     TEXT,
					completed_at   TEXT,
					duration_ms    INTEGER,
					created_at     TEXT     DEFAULT (datetime('now')) NOT NULL,
					updated_at     TEXT     DEFAULT (datetime('now')) NOT NULL,
					CONSTRAINT workflow_execution_steps_attempt_positive
						CHECK (attempt >= 1)
				)`,
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_execution_steps_attempt
					ON workflow_execution_steps (execution_id, task_id, attempt)`,
				`CREATE INDEX IF NOT EXISTS idx_workflow_execution_steps_execution_order
					ON workflow_execution_steps (execution_id, step_index)`,
			}
			if err := execStatements(tx, statements); err != nil {
				return err
			}
			log.Println("workflow run history migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			// Steps first: they carry the FK into executions.
			return execStatements(tx, []string{
				`DROP TABLE IF EXISTS workflow_execution_steps`,
				`DROP INDEX IF EXISTS idx_workflow_executions_app_started_at`,
				`ALTER TABLE workflow_executions DROP COLUMN IF EXISTS triggered_by`,
				`ALTER TABLE workflow_executions DROP COLUMN IF EXISTS trigger_event`,
			})
		},
	}
}
