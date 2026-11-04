package postgres

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddDatabaseRecords creates the rows of `woofx3:database` resource instances.
// Deleting the database instance retires its rows on purpose, hence the
// cascade. insert_key is the caller's idempotency key; NULLs never collide, so
// rows written without one are never deduplicated.
func AddDatabaseRecords() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0080_database_records",
		Migrate: func(db *gorm.DB) error {
			log.Println("Creating database_records...")
			for _, statement := range []string{
				`CREATE TABLE IF NOT EXISTS public.database_records (
					id                   UUID         NOT NULL PRIMARY KEY,
					database_instance_id UUID         NOT NULL REFERENCES public.module_resource_instances(id) ON DELETE CASCADE,
					record_values        JSONB        NOT NULL,
					insert_key           VARCHAR(255),
					revision             BIGINT       NOT NULL,
					created_at           TIMESTAMPTZ  NOT NULL,
					updated_at           TIMESTAMPTZ  NOT NULL
				)`,
				`CREATE INDEX IF NOT EXISTS idx_database_records_instance_created
					ON public.database_records (database_instance_id, created_at)`,
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_database_records_instance_insert_key
					ON public.database_records (database_instance_id, insert_key)`,
			} {
				if err := db.Exec(statement).Error; err != nil {
					return err
				}
			}
			log.Println("database_records migration complete")
			return nil
		},
		Rollback: func(db *gorm.DB) error {
			return db.Exec(`DROP TABLE IF EXISTS public.database_records`).Error
		},
	}
}
