package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// CreateOverlayTokensTable adds the `overlay_tokens` table.
func CreateOverlayTokensTable() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0017_overlay_tokens",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Creating overlay_tokens table...")
			statements := []string{
				`CREATE TABLE IF NOT EXISTS overlay_tokens (
					id             TEXT        NOT NULL PRIMARY KEY,
					token          TEXT                                   NOT NULL,
					scene_id       TEXT                                   NOT NULL,
					application_id TEXT                                   NOT NULL,
					label          TEXT        DEFAULT ''                 NOT NULL,
					status         TEXT        DEFAULT 'active'           NOT NULL,
					created_at     TEXT        DEFAULT (datetime('now'))  NOT NULL,
					revoked_at     TEXT,
					last_used_at   TEXT
				)`,
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_overlay_tokens_token
					ON overlay_tokens (token)`,
				`CREATE INDEX IF NOT EXISTS idx_overlay_tokens_scene_id
					ON overlay_tokens (scene_id)`,
				`CREATE INDEX IF NOT EXISTS idx_overlay_tokens_application_id
					ON overlay_tokens (application_id)`,
			}
			if err := execStatements(tx, statements); err != nil {
				return err
			}
			log.Println("overlay_tokens migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`DROP INDEX IF EXISTS idx_overlay_tokens_application_id`,
				`DROP INDEX IF EXISTS idx_overlay_tokens_scene_id`,
				`DROP INDEX IF EXISTS idx_overlay_tokens_token`,
				`DROP TABLE IF EXISTS overlay_tokens`,
			}
			if err := execStatements(tx, statements); err != nil {
				return err
			}
			return nil
		},
	}
}
