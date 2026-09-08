package postgres

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddTriggerPayloadSchemaColumn introduces a `payload_schema` column on
// `triggers` — a JSON-encoded DataSchema describing the shape of
// `trigger.data` when the trigger fires.
//
// Deliberately separate from `config_schema`, which describes the trigger's
// configuration form. The two are not the same shape: only config fields
// carrying an `eventPath` become variables today, so a trigger that emits
// payload keys it does not also expose as config fields has no way to
// advertise them. UI-only — the engine never validates an event payload
// against this. Defaults to '{}' (nothing declared) so existing rows keep
// working unchanged and the UI keeps deriving variables from config_schema.
func AddTriggerPayloadSchemaColumn() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0035_trigger_payload_schema",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding payload_schema column to triggers table...")
			stmt := `ALTER TABLE public.triggers
				ADD COLUMN IF NOT EXISTS payload_schema JSONB NOT NULL DEFAULT '{}'`
			if err := tx.Exec(stmt).Error; err != nil {
				return err
			}
			log.Println("Trigger payload_schema column migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return tx.Exec(`ALTER TABLE public.triggers DROP COLUMN IF EXISTS payload_schema`).Error
		},
	}
}
