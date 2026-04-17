package migrations

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

func CreateModuleResourcesTable() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "202604150002_create_module_resources_table",
		Migrate: func(tx *gorm.DB) error {
			if err := tx.Exec(`
				CREATE TABLE IF NOT EXISTS public.module_resources (
					id               UUID        DEFAULT uuid_generate_v4() NOT NULL,
					module_id        UUID        NOT NULL,
					resource_type    TEXT        NOT NULL,
					resource_id      UUID,
					manifest_id      TEXT        NOT NULL,
					resource_name    TEXT        NOT NULL,
					original_version TEXT        NOT NULL,
					current_version  TEXT        NOT NULL,
					installed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
					updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
				);
			`).Error; err != nil {
				return err
			}

			if err := tx.Exec(`
				DO $$
				BEGIN
					IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'module_resources_pkey') THEN
						ALTER TABLE public.module_resources ADD CONSTRAINT module_resources_pkey PRIMARY KEY (id);
					END IF;
				END
				$$;
			`).Error; err != nil {
				return err
			}

			if err := tx.Exec(`
				DO $$
				BEGIN
					IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_module_resources_module') THEN
						ALTER TABLE public.module_resources
						ADD CONSTRAINT fk_module_resources_module
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
				"CREATE INDEX IF NOT EXISTS idx_module_resources_module_id ON public.module_resources (module_id)",
				"CREATE INDEX IF NOT EXISTS idx_module_resources_resource_type ON public.module_resources (resource_type)",
				"CREATE INDEX IF NOT EXISTS idx_module_resources_manifest_id ON public.module_resources (module_id, manifest_id)",
			}

			for _, indexSQL := range indexes {
				if err := tx.Exec(indexSQL).Error; err != nil {
					return err
				}
			}

			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return tx.Exec("DROP TABLE IF EXISTS public.module_resources CASCADE").Error
		},
	}
}
