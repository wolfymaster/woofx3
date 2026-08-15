package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// CreateAssetsTable adds the `assets` table.
func CreateAssetsTable() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0007_assets",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Creating assets table...")
			statements := []string{
				`CREATE TABLE IF NOT EXISTS assets (
					id              TEXT        NOT NULL PRIMARY KEY,
					name            TEXT                                   NOT NULL,
					description     TEXT        DEFAULT ''                 NOT NULL,
					manifest_path   TEXT                                   NOT NULL,
					repository_key  TEXT                                   NOT NULL,
					kind            TEXT        DEFAULT ''                 NOT NULL,
					content_type    TEXT        DEFAULT ''                 NOT NULL,
					created_by_type TEXT        DEFAULT 'MODULE'           NOT NULL,
					created_by_ref  TEXT        DEFAULT ''                 NOT NULL,
					manifest_id     TEXT        DEFAULT ''                 NOT NULL,
					created_at      TEXT        DEFAULT (datetime('now'))  NOT NULL,
					updated_at      TEXT        DEFAULT (datetime('now'))  NOT NULL
				)`,
				`CREATE INDEX IF NOT EXISTS idx_assets_origin
					ON assets (created_by_type, created_by_ref)`,
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_origin_manifest
					ON assets (created_by_type, created_by_ref, manifest_id)`,
			}
			if err := execStatements(tx, statements); err != nil {
				return err
			}
			log.Println("assets migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`DROP INDEX IF EXISTS idx_assets_origin_manifest`,
				`DROP INDEX IF EXISTS idx_assets_origin`,
				`DROP TABLE IF EXISTS assets`,
			}
			if err := execStatements(tx, statements); err != nil {
				return err
			}
			return nil
		},
	}
}
