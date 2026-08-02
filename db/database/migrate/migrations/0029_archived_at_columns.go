package migrations

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddArchivedAtColumns adds `archived_at` to `triggers`, `actions`,
// `widgets`, and `functions`, and moves their uniqueness constraints to
// partial indexes scoped to `archived_at IS NULL`.
//
// Why: a module upgrade must never break an existing workflow/command
// that references a trigger/action/function/widget the new manifest no
// longer declares — deleting the row would make it unresolvable
// (`GetTriggerByCanonicalId` etc. would 404, and any workflow step that
// invokes an archived function would fail at execution time). Instead,
// barkloader's diff-based upgrade path (see module_install.rs
// `prune_removed_resources`) archives a removed resource — sets
// `archived_at` — rather than deleting it. Archived rows stay fully
// resolvable by canonical id (existing references keep working) but are
// excluded from `List*` catalog queries (the UI's "create workflow"
// pickers), satisfying "should not be visible in the UI going forward."
//
// The partial-unique-index shape (`WHERE archived_at IS NULL`) allows
// exactly one *active* row per (creator, manifest_id) at a time, while
// letting an archived row and a later re-added active row for the same
// manifest_id coexist (e.g. a resource removed in v2, then re-added in
// v3) without a uniqueness collision.
func AddArchivedAtColumns() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0029_archived_at_columns",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding archived_at columns and partial unique indexes...")
			statements := []string{
				`ALTER TABLE public.triggers ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ NULL`,
				`ALTER TABLE public.actions  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ NULL`,
				`ALTER TABLE public.widgets  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ NULL`,
				`ALTER TABLE public.functions ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ NULL`,

				// triggers: swap the full-table unique CONSTRAINT (which
				// can't carry a WHERE clause) for a partial unique INDEX.
				`ALTER TABLE public.triggers DROP CONSTRAINT IF EXISTS uq_triggers_creator_manifest_id`,
				`CREATE UNIQUE INDEX IF NOT EXISTS uq_triggers_creator_manifest_id_active
					ON public.triggers (created_by_type, created_by_ref, manifest_id)
					WHERE archived_at IS NULL`,

				// actions: same swap.
				`ALTER TABLE public.actions DROP CONSTRAINT IF EXISTS uq_actions_creator_manifest_id`,
				`CREATE UNIQUE INDEX IF NOT EXISTS uq_actions_creator_manifest_id_active
					ON public.actions (created_by_type, created_by_ref, manifest_id)
					WHERE archived_at IS NULL`,

				// widgets: was already a plain unique index, not a constraint.
				`DROP INDEX IF EXISTS idx_widgets_origin_manifest`,
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_widgets_origin_manifest_active
					ON public.widgets (created_by_type, created_by_ref, manifest_id)
					WHERE archived_at IS NULL`,

				// functions: never had a uniqueness constraint at all
				// (rows were wholesale deleted/recreated on every
				// install instead of upserted) — add one now, scoped to
				// non-empty manifest_id (legacy rows predating the
				// manifest_id column default to '').
				`CREATE UNIQUE INDEX IF NOT EXISTS uq_functions_module_manifest_active
					ON public.functions (module_id, manifest_id)
					WHERE archived_at IS NULL AND manifest_id <> ''`,
			}
			for _, stmt := range statements {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			log.Println("archived_at migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`DROP INDEX IF EXISTS uq_functions_module_manifest_active`,

				`DROP INDEX IF EXISTS idx_widgets_origin_manifest_active`,
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_widgets_origin_manifest
					ON public.widgets (created_by_type, created_by_ref, manifest_id)`,

				`DROP INDEX IF EXISTS uq_actions_creator_manifest_id_active`,
				`ALTER TABLE public.actions
					ADD CONSTRAINT uq_actions_creator_manifest_id UNIQUE (created_by_type, created_by_ref, manifest_id)`,

				`DROP INDEX IF EXISTS uq_triggers_creator_manifest_id_active`,
				`ALTER TABLE public.triggers
					ADD CONSTRAINT uq_triggers_creator_manifest_id UNIQUE (created_by_type, created_by_ref, manifest_id)`,

				`ALTER TABLE public.functions DROP COLUMN IF EXISTS archived_at`,
				`ALTER TABLE public.widgets   DROP COLUMN IF EXISTS archived_at`,
				`ALTER TABLE public.actions   DROP COLUMN IF EXISTS archived_at`,
				`ALTER TABLE public.triggers  DROP COLUMN IF EXISTS archived_at`,
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
