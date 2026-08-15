package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddTaxonomyColumns replaces triggers.category with taxonomy on
// triggers, actions, and workflow_definitions.
func AddTaxonomyColumns() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0024_taxonomy",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding taxonomy columns and migrating triggers.category...")
			stmts := []string{
				`ALTER TABLE triggers ADD COLUMN IF NOT EXISTS taxonomy TEXT NOT NULL DEFAULT '[]'`,
				`ALTER TABLE actions ADD COLUMN IF NOT EXISTS taxonomy TEXT NOT NULL DEFAULT '[]'`,
				`ALTER TABLE workflow_definitions ADD COLUMN IF NOT EXISTS taxonomy TEXT NOT NULL DEFAULT '[]'`,
				// jsonb_build_array(category) → simple JSON array text
				`UPDATE triggers SET taxonomy = '["' || replace(category, '"', '\"') || '"]' WHERE category IS NOT NULL AND category != ''`,
				`ALTER TABLE triggers DROP COLUMN IF EXISTS category`,
			}
			if err := execStatements(tx, stmts); err != nil {
				return err
			}
			log.Println("taxonomy columns added, triggers.category dropped")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			stmts := []string{
				`ALTER TABLE triggers ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT ''`,
				`UPDATE triggers SET category = COALESCE(json_extract(taxonomy, '$[0]'), '')`,
				`ALTER TABLE triggers DROP COLUMN IF EXISTS taxonomy`,
				`ALTER TABLE actions DROP COLUMN IF EXISTS taxonomy`,
				`ALTER TABLE workflow_definitions DROP COLUMN IF EXISTS taxonomy`,
			}
			if err := execStatements(tx, stmts); err != nil {
				return err
			}
			return nil
		},
	}
}
