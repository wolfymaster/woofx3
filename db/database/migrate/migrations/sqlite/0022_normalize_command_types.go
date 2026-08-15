package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// NormalizeCommandTypes backfills commands.type off the retired "static" /
// "dynamic" values.
func NormalizeCommandTypes() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0022_normalize_command_types",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Normalizing commands.type off legacy static/dynamic values...")
			result := tx.Exec(`UPDATE commands SET type = 'text' WHERE type IN ('static', 'dynamic')`)
			if result.Error != nil {
				return result.Error
			}
			log.Printf("Normalized %d command row(s) to type='text'", result.RowsAffected)
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			// Not reversible — deliberate no-op.
			return nil
		},
	}
}
