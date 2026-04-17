package migrations

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

func DecoupleTriggerActionsFromModules() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "202604150004_decouple_triggers_actions_from_modules",
		Migrate: func(tx *gorm.DB) error {
			// Rename module_functions -> functions
			if err := tx.Exec(`ALTER TABLE public.module_functions RENAME TO functions`).Error; err != nil {
				return err
			}

			// Rename module_triggers -> triggers, drop module_id and module_name
			if err := tx.Exec(`ALTER TABLE public.module_triggers RENAME TO triggers`).Error; err != nil {
				return err
			}

			// Drop the FK and unique constraints that reference module_id
			if err := tx.Exec(`
				ALTER TABLE public.triggers
					DROP CONSTRAINT IF EXISTS fk_module_triggers_module,
					DROP CONSTRAINT IF EXISTS uq_module_triggers_module_id_name;
			`).Error; err != nil {
				return err
			}

			// Drop old indexes that reference module_id
			if err := tx.Exec(`
				DROP INDEX IF EXISTS idx_module_triggers_module_id;
			`).Error; err != nil {
				return err
			}

			// Drop module_id and module_name columns
			if err := tx.Exec(`
				ALTER TABLE public.triggers
					DROP COLUMN IF EXISTS module_id,
					DROP COLUMN IF EXISTS module_name;
			`).Error; err != nil {
				return err
			}

			// Add new unique constraint: one trigger name per creator
			if err := tx.Exec(`
				DO $$
				BEGIN
					IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_triggers_creator_name') THEN
						ALTER TABLE public.triggers
						ADD CONSTRAINT uq_triggers_creator_name UNIQUE (created_by_type, created_by_ref, name);
					END IF;
				END
				$$;
			`).Error; err != nil {
				return err
			}

			// Rename module_actions -> actions, drop module_id and module_name
			if err := tx.Exec(`ALTER TABLE public.module_actions RENAME TO actions`).Error; err != nil {
				return err
			}

			// Drop FK constraint referencing module_id
			if err := tx.Exec(`
				ALTER TABLE public.actions
					DROP CONSTRAINT IF EXISTS fk_module_actions_module;
			`).Error; err != nil {
				return err
			}

			// Drop old indexes that reference module_id
			if err := tx.Exec(`
				DROP INDEX IF EXISTS idx_module_actions_module_id;
			`).Error; err != nil {
				return err
			}

			// Drop module_id and module_name columns
			if err := tx.Exec(`
				ALTER TABLE public.actions
					DROP COLUMN IF EXISTS module_id,
					DROP COLUMN IF EXISTS module_name;
			`).Error; err != nil {
				return err
			}

			// Add new unique constraint: one action name per creator
			if err := tx.Exec(`
				DO $$
				BEGIN
					IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_actions_creator_name') THEN
						ALTER TABLE public.actions
						ADD CONSTRAINT uq_actions_creator_name UNIQUE (created_by_type, created_by_ref, name);
					END IF;
				END
				$$;
			`).Error; err != nil {
				return err
			}

			// Rename old origin indexes to match new table names
			if err := tx.Exec(`
				DROP INDEX IF EXISTS idx_module_triggers_origin;
				CREATE INDEX IF NOT EXISTS idx_triggers_origin ON public.triggers (created_by_type, created_by_ref);
				DROP INDEX IF EXISTS idx_module_triggers_event;
				CREATE INDEX IF NOT EXISTS idx_triggers_event ON public.triggers (event);
				DROP INDEX IF EXISTS idx_module_actions_origin;
				CREATE INDEX IF NOT EXISTS idx_actions_origin ON public.actions (created_by_type, created_by_ref);
			`).Error; err != nil {
				return err
			}

			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			// Restore actions -> module_actions with module_id and module_name
			if err := tx.Exec(`
				ALTER TABLE public.actions
					ADD COLUMN IF NOT EXISTS module_id UUID,
					ADD COLUMN IF NOT EXISTS module_name TEXT NOT NULL DEFAULT '';
			`).Error; err != nil {
				return err
			}
			if err := tx.Exec(`ALTER TABLE public.actions RENAME TO module_actions`).Error; err != nil {
				return err
			}

			// Restore triggers -> module_triggers with module_id and module_name
			if err := tx.Exec(`
				ALTER TABLE public.triggers
					ADD COLUMN IF NOT EXISTS module_id UUID,
					ADD COLUMN IF NOT EXISTS module_name TEXT NOT NULL DEFAULT '';
			`).Error; err != nil {
				return err
			}
			if err := tx.Exec(`ALTER TABLE public.triggers RENAME TO module_triggers`).Error; err != nil {
				return err
			}

			// Restore functions -> module_functions
			if err := tx.Exec(`ALTER TABLE public.functions RENAME TO module_functions`).Error; err != nil {
				return err
			}

			return nil
		},
	}
}
