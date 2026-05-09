package migrations

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// CreateModuleResourceInstancesTable adds the `module_resource_instances`
// table — runtime-created instances of module-declared kinds. Distinct
// from `module_resources` (which tracks installed *surfaces* like
// triggers, actions, widgets) because instance lifecycle is driven by
// user actions, not module install/uninstall.
//
// Identity is `(module_id, kind, instance_id)`; the unique index enforces
// it. Canonical id is derived at the service layer as
// `{module.name}:{kind}:{instance_id}` and is not stored.
//
// FK to `modules.id` cascades on delete so an uninstalled module takes
// its orphan instances with it. Callers that want to refuse uninstall
// while instances exist should query first and surface the conflict.
func CreateModuleResourceInstancesTable() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0009_resource_instances",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Creating module_resource_instances table...")
			statements := []string{
				`CREATE TABLE IF NOT EXISTS public.module_resource_instances (
					id            UUID         DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
					module_id     UUID                                    NOT NULL REFERENCES public.modules(id) ON UPDATE CASCADE ON DELETE CASCADE,
					kind          TEXT                                    NOT NULL,
					instance_id   TEXT                                    NOT NULL,
					display_name  TEXT         DEFAULT ''                 NOT NULL,
					created_at    TIMESTAMPTZ  DEFAULT NOW()              NOT NULL,
					updated_at    TIMESTAMPTZ  DEFAULT NOW()              NOT NULL
				)`,
				`CREATE INDEX IF NOT EXISTS idx_mri_module_id
					ON public.module_resource_instances (module_id)`,
				`CREATE INDEX IF NOT EXISTS idx_mri_kind
					ON public.module_resource_instances (kind)`,
				// Identity uniqueness: one (module, kind, instance) row.
				// Backs the picker's "list by kind" path and prevents the
				// classic double-create race when a module retries.
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_mri_module_kind_instance
					ON public.module_resource_instances (module_id, kind, instance_id)`,
			}
			for _, stmt := range statements {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			log.Println("module_resource_instances migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`DROP INDEX IF EXISTS idx_mri_module_kind_instance`,
				`DROP INDEX IF EXISTS idx_mri_kind`,
				`DROP INDEX IF EXISTS idx_mri_module_id`,
				`DROP TABLE IF EXISTS public.module_resource_instances`,
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
