package migrations

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

func CreateModuleTriggerTable() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "202603270001_create_module_trigger_table",
		Migrate: func(tx *gorm.DB) error {
			if err := tx.Exec(`
				CREATE TABLE IF NOT EXISTS public.module_triggers (
					id             UUID        DEFAULT uuid_generate_v4() NOT NULL,
					module_id      UUID        NOT NULL,
					module_name    TEXT        NOT NULL,
					category       TEXT        NOT NULL,
					name           TEXT        NOT NULL,
					description    TEXT        NOT NULL DEFAULT '',
					event          TEXT        NOT NULL,
					config_schema  JSONB       NOT NULL DEFAULT '[]',
					allow_variants BOOLEAN     NOT NULL DEFAULT FALSE,
					created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
					updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
				);
			`).Error; err != nil {
				return err
			}

			if err := tx.Exec(`
				DO $$
				BEGIN
					IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'module_triggers_pkey') THEN
						ALTER TABLE public.module_triggers ADD CONSTRAINT module_triggers_pkey PRIMARY KEY (id);
					END IF;
				END
				$$;
			`).Error; err != nil {
				return err
			}

			if err := tx.Exec(`
				DO $$
				BEGIN
					IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_module_triggers_module') THEN
						ALTER TABLE public.module_triggers
						ADD CONSTRAINT fk_module_triggers_module
						FOREIGN KEY (module_id)
						REFERENCES public.modules(id)
						ON DELETE CASCADE;
					END IF;
				END
				$$;
			`).Error; err != nil {
				return err
			}

			if err := tx.Exec(`
				DO $$
				BEGIN
					IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_module_triggers_module_id_name') THEN
						ALTER TABLE public.module_triggers
						ADD CONSTRAINT uq_module_triggers_module_id_name UNIQUE (module_id, name);
					END IF;
				END
				$$;
			`).Error; err != nil {
				return err
			}

			indexes := []string{
				"CREATE INDEX IF NOT EXISTS idx_module_triggers_module_id ON public.module_triggers (module_id)",
				"CREATE INDEX IF NOT EXISTS idx_module_triggers_event ON public.module_triggers (event)",
			}

			for _, indexSQL := range indexes {
				if err := tx.Exec(indexSQL).Error; err != nil {
					return err
				}
			}

			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return tx.Exec("DROP TABLE IF EXISTS public.module_triggers CASCADE").Error
		},
	}
}
