package migrations

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

func CreateModuleActionsTable() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "202604150003_create_module_actions_table",
		Migrate: func(tx *gorm.DB) error {
			if err := tx.Exec(`
				CREATE TABLE IF NOT EXISTS public.module_actions (
					id              UUID        DEFAULT uuid_generate_v4() NOT NULL,
					module_id       UUID        NOT NULL,
					module_name     TEXT        NOT NULL,
					name            TEXT        NOT NULL,
					description     TEXT        NOT NULL DEFAULT '',
					call            TEXT        NOT NULL,
					params_schema   JSONB       NOT NULL DEFAULT '{}',
					created_by_type TEXT        NOT NULL DEFAULT 'MODULE',
					created_by_ref  TEXT        NOT NULL DEFAULT '',
					created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
					updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
				);
			`).Error; err != nil {
				return err
			}

			if err := tx.Exec(`
				DO $$
				BEGIN
					IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'module_actions_pkey') THEN
						ALTER TABLE public.module_actions ADD CONSTRAINT module_actions_pkey PRIMARY KEY (id);
					END IF;
				END
				$$;
			`).Error; err != nil {
				return err
			}

			if err := tx.Exec(`
				DO $$
				BEGIN
					IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_module_actions_module') THEN
						ALTER TABLE public.module_actions
						ADD CONSTRAINT fk_module_actions_module
						FOREIGN KEY (module_id)
						REFERENCES public.modules(id)
						ON DELETE CASCADE;
					END IF;
				END
				$$;
			`).Error; err != nil {
				return err
			}

			indexes := []string{
				"CREATE INDEX IF NOT EXISTS idx_module_actions_module_id ON public.module_actions (module_id)",
				"CREATE INDEX IF NOT EXISTS idx_module_actions_origin ON public.module_actions (created_by_type, created_by_ref)",
			}

			for _, indexSQL := range indexes {
				if err := tx.Exec(indexSQL).Error; err != nil {
					return err
				}
			}

			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return tx.Exec("DROP TABLE IF EXISTS public.module_actions CASCADE").Error
		},
	}
}
