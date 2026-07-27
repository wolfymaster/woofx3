package migrations

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddTaxonomyColumns replaces triggers.category (a single free-form string)
// with an open, multi-valued taxonomy column on triggers, actions, and
// workflow_definitions. Each entry is a dotted hierarchical classification
// string (e.g. "platform.twitch.chat"); multiple entries express
// independent classification axes on the same resource. Existing
// triggers.category values are backfilled into taxonomy as a single-element
// array before the column is dropped. actions and workflow_definitions have
// no prior classification column, so taxonomy is net new there.
func AddTaxonomyColumns() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0024_taxonomy",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding taxonomy columns and migrating triggers.category...")
			stmts := []string{
				`ALTER TABLE public.triggers ADD COLUMN IF NOT EXISTS taxonomy jsonb NOT NULL DEFAULT '[]'`,
				`ALTER TABLE public.actions ADD COLUMN IF NOT EXISTS taxonomy jsonb NOT NULL DEFAULT '[]'`,
				`ALTER TABLE public.workflow_definitions ADD COLUMN IF NOT EXISTS taxonomy jsonb NOT NULL DEFAULT '[]'`,
				`UPDATE public.triggers SET taxonomy = jsonb_build_array(category) WHERE category IS NOT NULL AND category != ''`,
				`ALTER TABLE public.triggers DROP COLUMN IF EXISTS category`,
			}
			for _, stmt := range stmts {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			log.Println("taxonomy columns added, triggers.category dropped")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			stmts := []string{
				`ALTER TABLE public.triggers ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT ''`,
				`UPDATE public.triggers SET category = COALESCE(taxonomy->>0, '')`,
				`ALTER TABLE public.triggers DROP COLUMN IF EXISTS taxonomy`,
				`ALTER TABLE public.actions DROP COLUMN IF EXISTS taxonomy`,
				`ALTER TABLE public.workflow_definitions DROP COLUMN IF EXISTS taxonomy`,
			}
			for _, stmt := range stmts {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			return nil
		},
	}
}
