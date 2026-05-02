package migrations

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddWorkflowManifestIDColumn adds the `manifest_id` column to
// `workflow_definitions`, mirroring the column on `triggers`, `actions`,
// and `functions`. Together with the existing `created_by_ref` (which
// stores the composite moduleKey for MODULE-owned workflows), this is
// the data we need to derive a stable UI projectionKey
// `{moduleKey}:workflow:{manifestId}` for module-installed workflows.
//
// Existing rows:
//   - User-created workflows have `created_by_type = 'USER'`, no
//     manifest id; `manifest_id` defaults to '' which is fine — these
//     don't get a projectionKey emitted.
//   - Module-created workflows registered before this migration have
//     `created_by_type = 'MODULE'` but `manifest_id = ''`. They won't
//     project until the owning module is reinstalled (which writes the
//     full row via barkloader). Backfilling from `name`'s
//     `{moduleName}/{wfName}` prefix is fragile — a reinstall is the
//     supported migration path.
func AddWorkflowManifestIDColumn() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0004_workflow_manifest_id",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding manifest_id column to workflow_definitions...")
			statements := []string{
				`ALTER TABLE public.workflow_definitions
					ADD COLUMN IF NOT EXISTS manifest_id TEXT NOT NULL DEFAULT ''`,
				`CREATE INDEX IF NOT EXISTS idx_workflow_definitions_creator_manifest_id
					ON public.workflow_definitions (created_by_type, created_by_ref, manifest_id)`,
			}
			for _, stmt := range statements {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			log.Println("workflow_definitions.manifest_id migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`DROP INDEX IF EXISTS idx_workflow_definitions_creator_manifest_id`,
				`ALTER TABLE public.workflow_definitions DROP COLUMN IF EXISTS manifest_id`,
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
