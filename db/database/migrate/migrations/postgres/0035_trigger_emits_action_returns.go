package postgres

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddTriggerEmitsAndActionReturns introduces `triggers.emits` and
// `actions.returns` — JSON-encoded DataShapes naming what a trigger's event
// payload carries and what an action's function hands back, so the workflow
// builder can offer `${trigger.data.X}` and `${tasks.<id>.<key>}` variables
// without guessing.
//
// Neither is a schema and neither is validated against at runtime; they answer
// "which paths can be referenced". See module_trigger.proto Trigger.emits.
//
// This also drops `actions.output_schema`, which carried the same intent for
// actions in ConfigField shape. It is removed rather than kept alongside
// because no module ever declared one: the manifest key that fed it (`outputs`)
// has no producers anywhere, so the column holds nothing but its own default.
// Keeping a second, form-shaped way to say the same thing would leave the
// exact overload `returns` exists to remove.
func AddTriggerEmitsAndActionReturns() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0035_trigger_emits_action_returns",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding triggers.emits and actions.returns...")
			statements := []string{
				`ALTER TABLE public.triggers ADD COLUMN IF NOT EXISTS emits JSONB NOT NULL DEFAULT '{}'`,
				`ALTER TABLE public.actions ADD COLUMN IF NOT EXISTS returns JSONB NOT NULL DEFAULT '{}'`,
				`ALTER TABLE public.actions DROP COLUMN IF EXISTS output_schema`,
			}
			for _, stmt := range statements {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			log.Println("Trigger emits / action returns migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`ALTER TABLE public.actions ADD COLUMN IF NOT EXISTS output_schema JSONB NOT NULL DEFAULT '[]'`,
				`ALTER TABLE public.actions DROP COLUMN IF EXISTS returns`,
				`ALTER TABLE public.triggers DROP COLUMN IF EXISTS emits`,
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
