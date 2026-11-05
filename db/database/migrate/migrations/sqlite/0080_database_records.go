package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddDatabaseRecords creates the rows of `woofx3:database` resource instances.
// See the postgres migration of the same ID. record_values is JSON text, read
// with the JSON1 functions.
func AddDatabaseRecords() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0080_database_records",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Creating database_records...")
			if err := execStatements(tx, []string{
				`CREATE TABLE IF NOT EXISTS database_records (
					id                   TEXT     NOT NULL PRIMARY KEY,
					database_instance_id TEXT     NOT NULL REFERENCES module_resource_instances(id) ON DELETE CASCADE,
					record_values        TEXT     NOT NULL,
					insert_key           TEXT,
					revision             INTEGER  NOT NULL,
					created_at           DATETIME NOT NULL,
					updated_at           DATETIME NOT NULL
				)`,
				`CREATE INDEX IF NOT EXISTS idx_database_records_instance_created
					ON database_records (database_instance_id, created_at)`,
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_database_records_instance_insert_key
					ON database_records (database_instance_id, insert_key)`,
			}); err != nil {
				return err
			}
			log.Println("database_records migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return execStatements(tx, []string{`DROP TABLE IF EXISTS database_records`})
		},
	}
}
