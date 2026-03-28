package migrations

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

func CreateModuleTables() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "202603210001_create_module_tables",
		Migrate: func(tx *gorm.DB) error {
			if err := tx.Exec(`
				CREATE TABLE IF NOT EXISTS public.modules (
					id           UUID      DEFAULT uuid_generate_v4() NOT NULL,
					name         TEXT      NOT NULL UNIQUE,
					version      TEXT      NOT NULL,
					manifest     TEXT,
					state        TEXT      DEFAULT 'active' NOT NULL,
					archive_key  TEXT,
					installed_at TIMESTAMP DEFAULT NOW() NOT NULL,
					updated_at   TIMESTAMP DEFAULT NOW() NOT NULL
				);
			`).Error; err != nil {
				return err
			}

			if err := tx.Exec(`
				DO $$
				BEGIN
					IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'modules_pkey') THEN
						ALTER TABLE public.modules ADD CONSTRAINT modules_pkey PRIMARY KEY (id);
					END IF;
				END
				$$;
			`).Error; err != nil {
				return err
			}

			if err := tx.Exec(`
				CREATE TABLE IF NOT EXISTS public.module_functions (
					id            UUID    DEFAULT uuid_generate_v4() NOT NULL,
					module_id     UUID    NOT NULL,
					function_name TEXT    NOT NULL,
					file_name     TEXT    NOT NULL,
					file_key      TEXT    NOT NULL,
					entry_point   TEXT    DEFAULT 'main',
					runtime       TEXT    NOT NULL
				);
			`).Error; err != nil {
				return err
			}

			if err := tx.Exec(`
				DO $$
				BEGIN
					IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'module_functions_pkey') THEN
						ALTER TABLE public.module_functions ADD CONSTRAINT module_functions_pkey PRIMARY KEY (id);
					END IF;
				END
				$$;
			`).Error; err != nil {
				return err
			}

			if err := tx.Exec(`
				DO $$
				BEGIN
					IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_module_functions_module') THEN
						ALTER TABLE public.module_functions
						ADD CONSTRAINT fk_module_functions_module
						FOREIGN KEY (module_id)
						REFERENCES public.modules(id)
						ON UPDATE CASCADE ON DELETE CASCADE;
					END IF;
				END
				$$;
			`).Error; err != nil {
				return err
			}

			indexes := []string{
				"CREATE INDEX IF NOT EXISTS idx_modules_name ON public.modules (name)",
				"CREATE INDEX IF NOT EXISTS idx_module_functions_module_id ON public.module_functions (module_id)",
			}

			for _, indexSQL := range indexes {
				if err := tx.Exec(indexSQL).Error; err != nil {
					return err
				}
			}

			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			tables := []string{
				"module_functions",
				"modules",
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
