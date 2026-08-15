package postgres

import (
	"fmt"
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// backfillModuleCreatedByRefTables lists every table whose MODULE-owned
// rows previously stored the composite moduleKey (`{id}:{version}:{hash}`)
// in `created_by_ref`. All six share the same shape: a `created_by_type`
// column, a `created_by_ref` column, a `manifest_id` column, and a unique
// (or, for workflow_definitions, partial-unique) index on
// (created_by_type, created_by_ref, manifest_id) that the barkloader
// upsert path now relies on.
var backfillModuleCreatedByRefTables = []string{
	"triggers",
	"actions",
	"widgets",
	"background_tasks",
	"assets",
	"workflow_definitions",
}

// BackfillModuleCreatedByRef rewrites `created_by_ref` on every
// MODULE-owned row from the composite `{id}:{version}:{hash}` moduleKey
// down to the bare stable manifest module id (the first `:`-delimited
// segment), matching the fix in barkloader's install path (see
// module_install.rs / module_manifest.rs) that stopped passing the
// composite key as the upsert identity.
//
// Without this backfill, existing installs would keep their old
// composite-shaped `created_by_ref` forever — the *next* upgrade of an
// already-installed module would insert one more (correctly bare-keyed)
// duplicate rather than truly reconciling history, and the old
// composite-keyed rows would never get cleaned up.
//
// Because multiple historical versions of the same module can each have
// left behind a row with their own distinct composite `created_by_ref`,
// rewriting them all down to the same bare id can collide with the
// (created_by_type, created_by_ref, manifest_id) unique index. So for
// each table: first delete all but the most-recently-updated row per
// (created_by_type, bare_id, manifest_id) group, then rewrite the
// survivors' `created_by_ref` in place.
func BackfillModuleCreatedByRef() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0027_backfill_module_created_by_ref",
		Migrate: func(tx *gorm.DB) error {
			for _, table := range backfillModuleCreatedByRefTables {
				log.Printf("Backfilling created_by_ref on %s...", table)

				dedupe := fmt.Sprintf(`
					DELETE FROM public.%s t
					USING public.%s newer
					WHERE t.created_by_type = 'MODULE'
					  AND t.created_by_ref LIKE '%%:%%:%%'
					  AND newer.created_by_type = 'MODULE'
					  AND newer.created_by_ref LIKE '%%:%%:%%'
					  AND split_part(t.created_by_ref, ':', 1) = split_part(newer.created_by_ref, ':', 1)
					  AND t.manifest_id = newer.manifest_id
					  AND (t.updated_at, t.id) < (newer.updated_at, newer.id)
				`, table, table)
				if err := tx.Exec(dedupe).Error; err != nil {
					return fmt.Errorf("dedupe %s: %w", table, err)
				}

				// Defensive: if a bare-id row already coexists with a
				// composite-keyed row for the same (type, id, manifest_id)
				// — shouldn't happen pre-fix, but avoid a constraint
				// violation on the rewrite below if it somehow does.
				dropStaleComposite := fmt.Sprintf(`
					DELETE FROM public.%s t
					WHERE t.created_by_type = 'MODULE'
					  AND t.created_by_ref LIKE '%%:%%:%%'
					  AND EXISTS (
						SELECT 1 FROM public.%s bare
						WHERE bare.created_by_type = 'MODULE'
						  AND bare.created_by_ref = split_part(t.created_by_ref, ':', 1)
						  AND bare.manifest_id = t.manifest_id
					  )
				`, table, table)
				if err := tx.Exec(dropStaleComposite).Error; err != nil {
					return fmt.Errorf("drop stale composite rows on %s: %w", table, err)
				}

				rewrite := fmt.Sprintf(`
					UPDATE public.%s
					SET created_by_ref = split_part(created_by_ref, ':', 1)
					WHERE created_by_type = 'MODULE' AND created_by_ref LIKE '%%:%%:%%'
				`, table)
				if err := tx.Exec(rewrite).Error; err != nil {
					return fmt.Errorf("rewrite %s: %w", table, err)
				}
			}
			log.Println("created_by_ref backfill complete")
			return nil
		},
		// Not reversible — the original composite key (which version/hash
		// produced each row) isn't recoverable once collapsed to the bare
		// id. Rolling back this migration leaves data as-is.
		Rollback: func(tx *gorm.DB) error {
			return nil
		},
	}
}
