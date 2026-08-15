package postgres

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddWorkflowDefinitionsUniqueConstraint promotes the existing non-unique
// `idx_workflow_definitions_creator_manifest_id` index (added by
// 0004_workflow_manifest_id) to a real UNIQUE constraint, so
// `workflow_definitions` can be upserted on
// `(created_by_type, created_by_ref, manifest_id)` the same way
// `triggers`, `actions`, `widgets`, `assets`, and `background_tasks`
// already are. Without this, every module upgrade inserted a brand new
// workflow row instead of updating the existing one in place.
//
// Rows that predate this migration can collide on the new constraint if
// a module was ever reinstalled with `force=true` in a way that left
// duplicate `(created_by_type, created_by_ref, manifest_id)` rows behind
// (or duplicates created before the barkloader/db fix that made
// `created_by_ref` stable across versions — see
// 0027_backfill_module_created_by_ref). Keep only the most recently
// updated row per key before adding the constraint so the migration
// doesn't fail on existing data.
func AddWorkflowDefinitionsUniqueConstraint() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0026_workflow_definitions_unique",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Deduplicating workflow_definitions before adding unique constraint...")
			statements := []string{
				// Keep the most recently updated row per
				// (created_by_type, created_by_ref, manifest_id); drop the rest.
				// Rows with manifest_id = '' (USER workflows, pre-migration
				// MODULE rows) are excluded — they're not part of the
				// upsert-by-manifest-id contract.
				`DELETE FROM public.workflow_definitions wd
					USING public.workflow_definitions newer
					WHERE wd.manifest_id <> ''
					  AND newer.manifest_id <> ''
					  AND wd.created_by_type = newer.created_by_type
					  AND wd.created_by_ref = newer.created_by_ref
					  AND wd.manifest_id = newer.manifest_id
					  AND (wd.updated_at, wd.id) < (newer.updated_at, newer.id)`,
				`DROP INDEX IF EXISTS idx_workflow_definitions_creator_manifest_id`,
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_definitions_creator_manifest_id
					ON public.workflow_definitions (created_by_type, created_by_ref, manifest_id)
					WHERE manifest_id <> ''`,
			}
			for _, stmt := range statements {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			log.Println("workflow_definitions unique constraint migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`DROP INDEX IF EXISTS idx_workflow_definitions_creator_manifest_id`,
				`CREATE INDEX IF NOT EXISTS idx_workflow_definitions_creator_manifest_id
					ON public.workflow_definitions (created_by_type, created_by_ref, manifest_id)`,
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
