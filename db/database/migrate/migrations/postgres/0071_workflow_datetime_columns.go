package postgres

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// DeclareWorkflowDatetimeColumns has nothing to do on Postgres, where the
// workflow_definitions table's timestamps were declared TIMESTAMP from the
// start. It exists so both dialects share one migration history; the SQLite
// migration of the same ID does the work.
func DeclareWorkflowDatetimeColumns() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0071_workflow_datetime_columns",
		Migrate: func(tx *gorm.DB) error {
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return nil
		},
	}
}
