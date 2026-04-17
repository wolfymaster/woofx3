package migrations

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// CreateResourceReferencesTable introduces the resource_references edge table
// used to track references from source resources (workflows, commands) to
// target resources (actions, triggers, functions, commands, workflows).
// The table is shaped as a directed edge: (source) --references--> (target).
// Edges are written whenever a source is created/updated and cleared when it
// is deleted, giving us a cheap lookup to decide whether a module's resources
// are still in use at delete time and to visualize dependency relationships.
func CreateResourceReferencesTable() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "202604170001_create_resource_references_table",
		Migrate: func(tx *gorm.DB) error {
			if err := tx.Exec(`
				CREATE TABLE IF NOT EXISTS public.resource_references (
					id                     UUID        DEFAULT uuid_generate_v4() NOT NULL,
					application_id         UUID,
					source_type            TEXT        NOT NULL,
					source_id              UUID        NOT NULL,
					source_name            TEXT        NOT NULL,
					source_created_by_type TEXT        NOT NULL DEFAULT 'USER',
					source_created_by_ref  TEXT        NOT NULL DEFAULT '',
					target_type            TEXT        NOT NULL,
					target_name            TEXT        NOT NULL,
					target_id              UUID,
					target_created_by_ref  TEXT,
					context                TEXT,
					created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
					updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
				);
			`).Error; err != nil {
				return err
			}

			if err := tx.Exec(`
				DO $$
				BEGIN
					IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'resource_references_pkey') THEN
						ALTER TABLE public.resource_references ADD CONSTRAINT resource_references_pkey PRIMARY KEY (id);
					END IF;
				END
				$$;
			`).Error; err != nil {
				return err
			}

			indexes := []string{
				"CREATE INDEX IF NOT EXISTS idx_rr_source ON public.resource_references (source_type, source_id)",
				"CREATE INDEX IF NOT EXISTS idx_rr_target_lookup ON public.resource_references (target_type, target_name)",
				"CREATE INDEX IF NOT EXISTS idx_rr_target_module ON public.resource_references (target_created_by_ref)",
				"CREATE INDEX IF NOT EXISTS idx_rr_application ON public.resource_references (application_id)",
			}

			for _, indexSQL := range indexes {
				if err := tx.Exec(indexSQL).Error; err != nil {
					return err
				}
			}

			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return tx.Exec("DROP TABLE IF EXISTS public.resource_references CASCADE").Error
		},
	}
}
