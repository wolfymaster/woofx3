package sqlite

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
func AddCanonicalIDColumns() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0002_canonical_id_columns",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding canonical-id columns to triggers / actions / functions...")

			statements := []string{
				`ALTER TABLE triggers ADD COLUMN IF NOT EXISTS manifest_id TEXT NOT NULL DEFAULT ''`,
				`ALTER TABLE actions ADD COLUMN IF NOT EXISTS manifest_id TEXT NOT NULL DEFAULT ''`,
				`ALTER TABLE functions ADD COLUMN IF NOT EXISTS manifest_id TEXT NOT NULL DEFAULT ''`,
				`ALTER TABLE functions ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT ''`,
			}

			if err := execStatements(tx, statements); err != nil {
				return err
			}

			// Functions: backfill manifest_id from legacy function_name, then drop it.
			hasFnName, err := columnExists(tx, "functions", "function_name")
			if err != nil {
				return err
			}
			if hasFnName {
				if err := tx.Exec(`
					UPDATE functions
					SET manifest_id = function_name
					WHERE manifest_id = '' AND function_name IS NOT NULL
				`).Error; err != nil {
					return err
				}
				if err := tx.Exec(`ALTER TABLE functions DROP COLUMN function_name`).Error; err != nil {
					return err
				}
			}

			postStatements := []string{
				`DROP INDEX IF EXISTS uq_triggers_creator_name`,
				`DROP INDEX IF EXISTS uq_actions_creator_name`,
				`CREATE UNIQUE INDEX IF NOT EXISTS uq_triggers_creator_manifest_id
					ON triggers (created_by_type, created_by_ref, manifest_id)`,
				`CREATE UNIQUE INDEX IF NOT EXISTS uq_actions_creator_manifest_id
					ON actions (created_by_type, created_by_ref, manifest_id)`,
			}
			if err := execStatements(tx, postStatements); err != nil {
				return err
			}
			log.Println("Canonical-id column migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`DROP INDEX IF EXISTS uq_triggers_creator_manifest_id`,
				`DROP INDEX IF EXISTS uq_actions_creator_manifest_id`,
				`ALTER TABLE triggers DROP COLUMN IF EXISTS manifest_id`,
				`ALTER TABLE actions DROP COLUMN IF EXISTS manifest_id`,
				`ALTER TABLE functions DROP COLUMN IF EXISTS manifest_id`,
				`ALTER TABLE functions DROP COLUMN IF EXISTS name`,
			}
			if err := execStatements(tx, statements); err != nil {
				return err
			}
			return nil
		},
	}
}
