package migrations

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// NormalizeCommandTypes backfills commands.type off the retired "static" /
// "dynamic" values. The shared TS contract (CommandType in
// shared/clients/typescript/api/api.ts) was collapsed to "text" | "function"
// when {template} substitution became unconditional for text responses -
// "dynamic" (templated) and "static" (literal) stopped being a meaningful
// distinction, since a "static" response with no `{...}` in it resolves to
// itself unchanged. This migration was missed when that contract change
// shipped, leaving pre-existing rows with a `type` value the contract no
// longer recognizes - Convex correctly rejects those rows outright rather
// than silently coercing them, so `listCommands()` returns unusable rows for
// any command created before this change until this runs.
func NormalizeCommandTypes() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0022_normalize_command_types",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Normalizing commands.type off legacy static/dynamic values...")
			result := tx.Exec(`UPDATE public.commands SET type = 'text' WHERE type IN ('static', 'dynamic')`)
			if result.Error != nil {
				return result.Error
			}
			log.Printf("Normalized %d command row(s) to type='text'", result.RowsAffected)
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			// Not reversible: the original static/dynamic distinction is
			// gone from the moment of the write, so there's nothing to
			// restore it from. Rollback is a deliberate no-op.
			return nil
		},
	}
}
