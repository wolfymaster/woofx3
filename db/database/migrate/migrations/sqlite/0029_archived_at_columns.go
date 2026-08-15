package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddArchivedAtColumns adds archived_at and swaps uniqueness to partial indexes.
func AddArchivedAtColumns() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0029_archived_at_columns",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding archived_at columns and partial unique indexes...")
			statements := []string{
				`ALTER TABLE triggers ADD COLUMN IF NOT EXISTS archived_at TEXT NULL`,
				`ALTER TABLE actions ADD COLUMN IF NOT EXISTS archived_at TEXT NULL`,
				`ALTER TABLE widgets ADD COLUMN IF NOT EXISTS archived_at TEXT NULL`,
				`ALTER TABLE functions ADD COLUMN IF NOT EXISTS archived_at TEXT NULL`,

				`DROP INDEX IF EXISTS uq_triggers_creator_manifest_id`,
				`CREATE UNIQUE INDEX IF NOT EXISTS uq_triggers_creator_manifest_id_active
					ON triggers (created_by_type, created_by_ref, manifest_id)
					WHERE archived_at IS NULL`,

				`DROP INDEX IF EXISTS uq_actions_creator_manifest_id`,
				`CREATE UNIQUE INDEX IF NOT EXISTS uq_actions_creator_manifest_id_active
					ON actions (created_by_type, created_by_ref, manifest_id)
					WHERE archived_at IS NULL`,

				`DROP INDEX IF EXISTS idx_widgets_origin_manifest`,
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_widgets_origin_manifest_active
					ON widgets (created_by_type, created_by_ref, manifest_id)
					WHERE archived_at IS NULL`,

				`CREATE UNIQUE INDEX IF NOT EXISTS uq_functions_module_manifest_active
					ON functions (module_id, manifest_id)
					WHERE archived_at IS NULL AND manifest_id <> ''`,
			}
			if err := execStatements(tx, statements); err != nil {
				return err
			}
			log.Println("archived_at migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`DROP INDEX IF EXISTS uq_functions_module_manifest_active`,

				`DROP INDEX IF EXISTS idx_widgets_origin_manifest_active`,
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_widgets_origin_manifest
					ON widgets (created_by_type, created_by_ref, manifest_id)`,

				`DROP INDEX IF EXISTS uq_actions_creator_manifest_id_active`,
				`CREATE UNIQUE INDEX IF NOT EXISTS uq_actions_creator_manifest_id
					ON actions (created_by_type, created_by_ref, manifest_id)`,

				`DROP INDEX IF EXISTS uq_triggers_creator_manifest_id_active`,
				`CREATE UNIQUE INDEX IF NOT EXISTS uq_triggers_creator_manifest_id
					ON triggers (created_by_type, created_by_ref, manifest_id)`,

				`ALTER TABLE functions DROP COLUMN IF EXISTS archived_at`,
				`ALTER TABLE widgets DROP COLUMN IF EXISTS archived_at`,
				`ALTER TABLE actions DROP COLUMN IF EXISTS archived_at`,
				`ALTER TABLE triggers DROP COLUMN IF EXISTS archived_at`,
			}
			if err := execStatements(tx, statements); err != nil {
				return err
			}
			return nil
		},
	}
}
