package migrations

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddActionOutputSchemaColumn introduces an `output_schema` column on
// `actions` — a JSON-encoded array of ConfigField-shaped declarations
// describing the shape of the action function's return value (e.g. the
// counter module's increment action returns `{next, previous, step}`).
// UI-only: the engine treats function results as opaque map[string]any
// at runtime; this powers the workflow builder's ${stepId.field}
// variable autocomplete. Defaults to '[]' (no declared outputs) so
// existing rows keep working unchanged.
func AddActionOutputSchemaColumn() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0025_action_output_schema",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding output_schema column to actions table...")
			stmt := `ALTER TABLE public.actions
				ADD COLUMN IF NOT EXISTS output_schema JSONB NOT NULL DEFAULT '[]'`
			if err := tx.Exec(stmt).Error; err != nil {
				return err
			}
			log.Println("Action output_schema column migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return tx.Exec(`ALTER TABLE public.actions DROP COLUMN IF EXISTS output_schema`).Error
		},
	}
}
