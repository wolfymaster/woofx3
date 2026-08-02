package migrations

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddModuleResourcesUniqueConstraint adds a UNIQUE constraint on
// `module_resources (module_id, resource_type, manifest_id)` so the
// ledger can be upserted instead of always inserted. Before this, every
// install (including every version upgrade of an already-installed
// module) inserted a fresh ledger row per resource, leaving the table an
// ever-growing append log with no way to tell "the current state of
// module X" from "every state module X has ever been in."
//
// Existing data can have multiple historical rows per
// (module_id, resource_type, manifest_id) — one per past install. Keep
// only the most recently updated row before adding the constraint.
func AddModuleResourcesUniqueConstraint() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0028_module_resources_unique",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Deduplicating module_resources before adding unique constraint...")
			statements := []string{
				`DELETE FROM public.module_resources mr
					USING public.module_resources newer
					WHERE mr.module_id = newer.module_id
					  AND mr.resource_type = newer.resource_type
					  AND mr.manifest_id = newer.manifest_id
					  AND (mr.updated_at, mr.id) < (newer.updated_at, newer.id)`,
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_module_resources_unique
					ON public.module_resources (module_id, resource_type, manifest_id)`,
			}
			for _, stmt := range statements {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			log.Println("module_resources unique constraint migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return tx.Exec(`DROP INDEX IF EXISTS idx_module_resources_unique`).Error
		},
	}
}
