package migrations

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

func CreateWorkflowTables() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "202412310002_create_workflow_tables",
		Migrate: func(tx *gorm.DB) error {
			// Create workflow_definitions table
			if err := tx.Exec(`
				CREATE TABLE IF NOT EXISTS public.workflow_definitions (
					id             UUID      DEFAULT uuid_generate_v4() NOT NULL,
					application_id UUID                                 NOT NULL,
					name           VARCHAR(255)                         NOT NULL,
					steps          JSONB,
					trigger        JSONB,
					created_at     TIMESTAMP DEFAULT NOW()              NOT NULL,
					updated_at     TIMESTAMP DEFAULT NOW()              NOT NULL
				);
			`).Error; err != nil {
				return err
			}

			// Add primary key constraint for workflow_definitions if not exists
			if err := tx.Exec(`
				DO $$
				BEGIN
					IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_definitions_pkey') THEN
						ALTER TABLE public.workflow_definitions ADD CONSTRAINT workflow_definitions_pkey PRIMARY KEY (id);
					END IF;
				END
				$$;
			`).Error; err != nil {
				return err
			}

			// Add foreign key constraint for workflow_definitions
			if err := tx.Exec(`
				DO $$
				BEGIN
					IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_workflow_definitions_application') THEN
						ALTER TABLE public.workflow_definitions 
						ADD CONSTRAINT fk_workflow_definitions_application 
						FOREIGN KEY (application_id) 
						REFERENCES public.applications(id) 
						ON UPDATE CASCADE ON DELETE CASCADE;
					END IF;
				END
				$$;
			`).Error; err != nil {
				return err
			}

			// Create workflow_executions table
			if err := tx.Exec(`
				CREATE TABLE IF NOT EXISTS public.workflow_executions (
					id             UUID         DEFAULT uuid_generate_v4() NOT NULL,
					workflow_id    UUID                                     NOT NULL,
					application_id UUID                                     NOT NULL,
					user_id        UUID                                     NOT NULL,
					status         VARCHAR(20)  DEFAULT 'pending'          NOT NULL,
					input          JSONB,
					output         JSONB,
					error          TEXT,
					started_at     TIMESTAMP,
					completed_at   TIMESTAMP,
					created_at     TIMESTAMP    DEFAULT NOW()               NOT NULL,
					updated_at     TIMESTAMP    DEFAULT NOW()               NOT NULL
				);
			`).Error; err != nil {
				return err
			}

			// Add primary key constraint for workflow_executions if not exists
			if err := tx.Exec(`
				DO $$
				BEGIN
					IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_executions_pkey') THEN
						ALTER TABLE public.workflow_executions ADD CONSTRAINT workflow_executions_pkey PRIMARY KEY (id);
					END IF;
				END
				$$;
			`).Error; err != nil {
				return err
			}

			// Add foreign key constraints for workflow_executions
			if err := tx.Exec(`
				DO $$
				BEGIN
					IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_workflow_executions_workflow') THEN
						ALTER TABLE public.workflow_executions 
						ADD CONSTRAINT fk_workflow_executions_workflow 
						FOREIGN KEY (workflow_id) 
						REFERENCES public.workflow_definitions(id) 
						ON UPDATE CASCADE ON DELETE CASCADE;
					END IF;
					
					IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_workflow_executions_application') THEN
						ALTER TABLE public.workflow_executions 
						ADD CONSTRAINT fk_workflow_executions_application 
						FOREIGN KEY (application_id) 
						REFERENCES public.applications(id) 
						ON UPDATE CASCADE ON DELETE CASCADE;
					END IF;
					
					IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_workflow_executions_user') THEN
						ALTER TABLE public.workflow_executions 
						ADD CONSTRAINT fk_workflow_executions_user 
						FOREIGN KEY (user_id) 
						REFERENCES public.users(id) 
						ON UPDATE CASCADE ON DELETE CASCADE;
					END IF;
				END
				$$;
			`).Error; err != nil {
				return err
			}

			// Create indexes if they don't exist
			indexes := []string{
				// workflow_definitions indexes
				"CREATE INDEX IF NOT EXISTS idx_workflow_definitions_application_id ON public.workflow_definitions (application_id)",

				// workflow_executions indexes
				"CREATE INDEX IF NOT EXISTS idx_workflow_executions_workflow_id ON public.workflow_executions (workflow_id)",
				"CREATE INDEX IF NOT EXISTS idx_workflow_executions_application_id ON public.workflow_executions (application_id)",
				"CREATE INDEX IF NOT EXISTS idx_workflow_executions_user_id ON public.workflow_executions (user_id)",
				"CREATE INDEX IF NOT EXISTS idx_workflow_executions_status ON public.workflow_executions (status)",
				"CREATE INDEX IF NOT EXISTS idx_workflow_executions_started_at ON public.workflow_executions (started_at)",
				"CREATE INDEX IF NOT EXISTS idx_workflow_executions_completed_at ON public.workflow_executions (completed_at)",
			}

			for _, indexSQL := range indexes {
				if err := tx.Exec(indexSQL).Error; err != nil {
					return err
				}
			}

			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			// Drop tables in reverse order to respect foreign key constraints
			tables := []string{
				"workflow_executions",
				"workflow_definitions",
			}

			for _, table := range tables {
				if err := tx.Exec("DROP TABLE IF EXISTS public." + table + " CASCADE").Error; err != nil {
					return err
				}
			}

			return nil
		},
	}
}
