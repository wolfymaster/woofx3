package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// CreateSceneBackupsTable adds `scene_backups`. See the postgres migration of
// the same ID for the shape decisions.
func CreateSceneBackupsTable() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0062_scene_backups",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Creating scene_backups table...")
			return execStatements(tx, []string{
				`CREATE TABLE IF NOT EXISTS scene_backups (
					id            TEXT     NOT NULL PRIMARY KEY,
					scene_id      TEXT     NOT NULL,
					version       TEXT     NOT NULL CONSTRAINT scene_backups_version_known CHECK (version IN ('published', 'draft')),
					source_column TEXT     NOT NULL CONSTRAINT scene_backups_column_known CHECK (source_column IN ('widgets', 'layout', 'behaviors')),
					reason        TEXT     NOT NULL CONSTRAINT scene_backups_reason_known CHECK (reason IN ('unreadable_column', 'unreadable_placements')),
					content       TEXT     NOT NULL,
					created_at    DATETIME NOT NULL DEFAULT (datetime('now'))
				)`,
				`CREATE INDEX IF NOT EXISTS idx_scene_backups_scene_created ON scene_backups (scene_id, created_at)`,
			})
		},
		Rollback: func(tx *gorm.DB) error {
			return execStatements(tx, []string{`DROP TABLE IF EXISTS scene_backups`})
		},
	}
}
