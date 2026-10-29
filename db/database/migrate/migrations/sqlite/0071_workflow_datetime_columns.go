package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// DeclareWorkflowDatetimeColumns re-declares the workflow_definitions table's
// timestamps as DATETIME, for the reason 0049_datetime_columns gives: the
// SQLite driver decodes a stored timestamp into a time.Time only for a date or
// time column. The workflow model reads them, so without this every workflow
// read fails on SQLite. Stored values are copied as they are.
//
// workflow_executions holds a foreign key to workflow_definitions with ON
// DELETE CASCADE, so this runs like 0049: foreign key enforcement off, one
// transaction, and a foreign key check before commit.
func DeclareWorkflowDatetimeColumns() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0071_workflow_datetime_columns",
		Migrate: func(db *gorm.DB) error {
			log.Println("Declaring workflow timestamp columns DATETIME...")
			return withForeignKeysDisabled(db, func(conn *gorm.DB) error {
				return conn.Transaction(func(tx *gorm.DB) error {
					rebuild := tableRebuild{table: "workflow_definitions", datetime: []string{"created_at", "updated_at"}}
					if err := rebuildTable(tx, rebuild); err != nil {
						return err
					}
					return assertForeignKeysHold(tx)
				})
			})
		},
		Rollback: func(tx *gorm.DB) error {
			// Declaring the columns TEXT again would make every workflow
			// unreadable. Rollback is a deliberate no-op.
			return nil
		},
	}
}
