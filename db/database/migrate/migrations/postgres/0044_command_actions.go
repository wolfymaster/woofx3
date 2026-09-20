package postgres

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/wolfymaster/woofx3/db/database/migrate/migrations/commandactions"
	"gorm.io/gorm"
)

// CommandActions replaces a command's type/type_value pair with an ordered
// list of actions.
//
// "text" and "function" were both actions all along: one sends a chat message,
// the other invokes a module function. Storing an action list instead lets a
// command do anything a workflow step can, and collapses type_value's two
// meanings into one shape (see command.proto's actions_json).
func CommandActions() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0044_command_actions",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Converting commands to action lists...")
			if err := tx.Exec(`ALTER TABLE public.commands
				ADD COLUMN IF NOT EXISTS actions JSONB NOT NULL DEFAULT '[]'::jsonb`).Error; err != nil {
				return err
			}

			converted, err := commandactions.Convert(tx, "public.commands")
			if err != nil {
				return err
			}
			log.Printf("Converted %d command row(s) to action lists", converted)

			for _, statement := range []string{
				`ALTER TABLE public.commands DROP COLUMN IF EXISTS type`,
				`ALTER TABLE public.commands DROP COLUMN IF EXISTS type_value`,
			} {
				if err := tx.Exec(statement).Error; err != nil {
					return err
				}
			}
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			// Not reversible: an action list holding anything but a single
			// chat.reply or function step has no type/type_value to go back to,
			// and restoring the columns would lose it silently.
			return nil
		},
	}
}
