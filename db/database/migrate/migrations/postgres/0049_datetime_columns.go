package postgres

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// DeclareDatetimeColumns has nothing to do on Postgres, where the timestamp
// columns were declared TIMESTAMPTZ from the start. It exists so both dialects
// share one migration history; the SQLite migration of the same ID does the
// work.
func DeclareDatetimeColumns() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0049_datetime_columns",
		Migrate: func(tx *gorm.DB) error {
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return nil
		},
	}
}
