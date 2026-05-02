package migrations

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddCanonicalIDColumns brings live databases up to the canonical-id
// schema introduced after the initial consolidated migration. Fresh
// installs already get these columns from the CREATE TABLE statements
// in 0001; this migration is a no-op for them (every step uses an
// IF NOT EXISTS / IF EXISTS guard). For databases that ran 0001 before
// the rework, this is the upgrade path.
//
// What the rework changed:
//
//   - `triggers.manifest_id` (TEXT, default '') — stable manifest-local
//     trigger id; canonical id is `{moduleId}:trigger:{manifest_id}`.
//   - `actions.manifest_id`  (TEXT, default '') — same idea for actions.
//   - `functions.manifest_id` (TEXT, default '') — replaces the legacy
//     `functions.function_name` column. Existing rows are backfilled
//     from `function_name` and the old column is dropped.
//   - `functions.name` (TEXT, default '') — display name, distinct
//     from the identifier.
//   - The (created_by_type, created_by_ref, name) uniqueness on
//     triggers/actions is replaced by (created_by_type, created_by_ref,
//     manifest_id) — display names can drift between versions, the
//     manifest id is the stable identity.
func AddCanonicalIDColumns() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0002_canonical_id_columns",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding canonical-id columns to triggers / actions / functions...")

			statements := []string{
				// New manifest-local id columns.
				`ALTER TABLE public.triggers
					ADD COLUMN IF NOT EXISTS manifest_id TEXT NOT NULL DEFAULT ''`,
				`ALTER TABLE public.actions
					ADD COLUMN IF NOT EXISTS manifest_id TEXT NOT NULL DEFAULT ''`,
				`ALTER TABLE public.functions
					ADD COLUMN IF NOT EXISTS manifest_id TEXT NOT NULL DEFAULT ''`,
				`ALTER TABLE public.functions
					ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT ''`,

				// Functions: backfill manifest_id from the legacy
				// function_name column, then drop function_name. No-op
				// when function_name was never created (fresh installs).
				`DO $$
				BEGIN
					IF EXISTS (
						SELECT 1 FROM information_schema.columns
						WHERE table_schema = 'public'
						  AND table_name = 'functions'
						  AND column_name = 'function_name'
					) THEN
						UPDATE public.functions
							SET manifest_id = function_name
							WHERE manifest_id = '' AND function_name IS NOT NULL;
						ALTER TABLE public.functions DROP COLUMN function_name;
					END IF;
				END
				$$`,

				// Replace the name-based uniqueness with manifest_id.
				`ALTER TABLE public.triggers
					DROP CONSTRAINT IF EXISTS uq_triggers_creator_name`,
				`ALTER TABLE public.actions
					DROP CONSTRAINT IF EXISTS uq_actions_creator_name`,
				`DO $$
				BEGIN
					IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_triggers_creator_manifest_id') THEN
						ALTER TABLE public.triggers
							ADD CONSTRAINT uq_triggers_creator_manifest_id UNIQUE (created_by_type, created_by_ref, manifest_id);
					END IF;
					IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_actions_creator_manifest_id') THEN
						ALTER TABLE public.actions
							ADD CONSTRAINT uq_actions_creator_manifest_id UNIQUE (created_by_type, created_by_ref, manifest_id);
					END IF;
				END
				$$`,
			}

			for _, stmt := range statements {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			log.Println("Canonical-id column migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			// Drop the new columns and uniqueness constraints; leave
			// the legacy `functions.function_name` gone — no automatic
			// way to restore the previous state once data has been
			// backfilled. Callers needing a true rollback should
			// restore from a backup.
			statements := []string{
				`ALTER TABLE public.triggers
					DROP CONSTRAINT IF EXISTS uq_triggers_creator_manifest_id`,
				`ALTER TABLE public.actions
					DROP CONSTRAINT IF EXISTS uq_actions_creator_manifest_id`,
				`ALTER TABLE public.triggers DROP COLUMN IF EXISTS manifest_id`,
				`ALTER TABLE public.actions DROP COLUMN IF EXISTS manifest_id`,
				`ALTER TABLE public.functions DROP COLUMN IF EXISTS manifest_id`,
				`ALTER TABLE public.functions DROP COLUMN IF EXISTS name`,
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
