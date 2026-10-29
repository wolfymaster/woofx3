package postgres

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// DeclareSceneDatetimeColumns has nothing to do on Postgres, where the scenes
// table's timestamps were declared TIMESTAMP from the start. It exists so both
// dialects share one migration history; the SQLite migration of the same ID
// does the work.
func DeclareSceneDatetimeColumns() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0070_scene_datetime_columns",
		Migrate: func(tx *gorm.DB) error {
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return nil
		},
	}
}
