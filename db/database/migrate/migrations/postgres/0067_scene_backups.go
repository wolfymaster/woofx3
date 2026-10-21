package postgres

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// CreateSceneBackupsTable adds `scene_backups`: stored scene data a repair
// replaced because this engine could not read it, kept exactly as it was.
//
//   - content is TEXT, not JSONB: what it holds may not be JSON at all.
//   - source_column names the scene column the content came from ("column"
//     is a reserved word).
//   - No foreign key to scenes: a backup outlives the scene it came from,
//     since deleting a scene is no reason to lose what was set aside from it.
//   - Append-only. Nothing reads it in normal operation.
func CreateSceneBackupsTable() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0067_scene_backups",
		Migrate: func(tx *gorm.DB) error {
			statements := []string{
				`CREATE TABLE IF NOT EXISTS public.scene_backups (
					id            UUID        NOT NULL PRIMARY KEY,
					scene_id      UUID        NOT NULL,
					version       TEXT        NOT NULL CONSTRAINT scene_backups_version_known CHECK (version IN ('published', 'draft')),
					source_column TEXT        NOT NULL CONSTRAINT scene_backups_column_known CHECK (source_column IN ('widgets', 'layout', 'behaviors')),
					reason        TEXT        NOT NULL CONSTRAINT scene_backups_reason_known CHECK (reason IN ('unreadable_column', 'unreadable_placements')),
					content       TEXT        NOT NULL,
					created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
				)`,
				`CREATE INDEX IF NOT EXISTS idx_scene_backups_scene_created ON public.scene_backups (scene_id, created_at)`,
			}
			for _, stmt := range statements {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return tx.Exec(`DROP TABLE IF EXISTS public.scene_backups`).Error
		},
	}
}
