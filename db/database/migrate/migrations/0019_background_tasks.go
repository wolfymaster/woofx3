package migrations

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

func CreateBackgroundTasksTable() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0019_background_tasks",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Creating background_tasks table...")
			statements := []string{
				`CREATE TABLE IF NOT EXISTS public.background_tasks (
					id              UUID        DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
					name            TEXT        DEFAULT ''                 NOT NULL,
					description     TEXT        DEFAULT ''                 NOT NULL,
					function        TEXT                                   NOT NULL,
					schedule        TEXT                                   NOT NULL,
					created_by_type TEXT        DEFAULT 'MODULE'           NOT NULL,
					created_by_ref  TEXT        DEFAULT ''                 NOT NULL,
					manifest_id     TEXT        DEFAULT ''                 NOT NULL,
					application_id  TEXT        DEFAULT ''                 NOT NULL,
					created_at      TIMESTAMPTZ DEFAULT NOW()              NOT NULL,
					updated_at      TIMESTAMPTZ DEFAULT NOW()              NOT NULL
				)`,
				`CREATE INDEX IF NOT EXISTS idx_background_tasks_origin
					ON public.background_tasks (created_by_type, created_by_ref)`,
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_background_tasks_origin_manifest
					ON public.background_tasks (created_by_type, created_by_ref, manifest_id)`,
			}
			for _, stmt := range statements {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			log.Println("background_tasks migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`DROP INDEX IF EXISTS idx_background_tasks_origin_manifest`,
				`DROP INDEX IF EXISTS idx_background_tasks_origin`,
				`DROP TABLE IF EXISTS public.background_tasks`,
			}
			for _, stmt := range statements {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			return nil
		},
	}
}
