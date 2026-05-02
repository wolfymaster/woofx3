package migrations

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddActionTypeColumn introduces a `type` column on `actions` that
// names the engine action handler the action dispatches to (e.g.
// `function`, `alert`, `print`). Pre-rework actions were always
// function dispatches; the column defaults to `function` so existing
// rows keep their semantics. Built-in non-function actions
// (registered by the workflow service on startup) carry the handler
// name they map to (`alert`, etc.) in this column.
//
// `actions.call` keeps its meaning — canonical function id when
// `type = 'function'`, empty otherwise.
func AddActionTypeColumn() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0003_action_type_column",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding type column to actions table...")
			statements := []string{
				`ALTER TABLE public.actions
					ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'function'`,
				`CREATE INDEX IF NOT EXISTS idx_actions_type ON public.actions (type)`,
			}
			for _, stmt := range statements {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			log.Println("Action type column migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`DROP INDEX IF EXISTS public.idx_actions_type`,
				`ALTER TABLE public.actions DROP COLUMN IF EXISTS type`,
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
