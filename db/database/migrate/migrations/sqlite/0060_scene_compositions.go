package sqlite

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddSceneCompositions adds `scenes.kind`, `behaviors_json`,
// `draft_behaviors_json` and `inputs_json`, and makes names unique per kind.
// See the postgres migration of the same ID.
func AddSceneCompositions() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0060_scene_compositions",
		Migrate: func(tx *gorm.DB) error {
			return execStatements(tx, []string{
				`ALTER TABLE scenes ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'scene'
					CONSTRAINT scenes_kind_known CHECK (kind IN ('scene', 'alert'))`,
				`ALTER TABLE scenes ADD COLUMN IF NOT EXISTS behaviors_json TEXT NOT NULL DEFAULT '{}'`,
				`ALTER TABLE scenes ADD COLUMN IF NOT EXISTS draft_behaviors_json TEXT`,
				`ALTER TABLE scenes ADD COLUMN IF NOT EXISTS inputs_json TEXT NOT NULL DEFAULT '[]'`,
				`DROP INDEX IF EXISTS idx_scenes_name`,
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_scenes_kind_name ON scenes (kind, name)`,
			})
		},
		// Deletes every alert, as the postgres rollback does.
		Rollback: func(tx *gorm.DB) error {
			return execStatements(tx, []string{
				`DROP INDEX IF EXISTS idx_scenes_kind_name`,
				`DELETE FROM scenes WHERE kind <> 'scene'`,
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_scenes_name ON scenes (name)`,
				`ALTER TABLE scenes DROP COLUMN IF EXISTS inputs_json`,
				`ALTER TABLE scenes DROP COLUMN IF EXISTS draft_behaviors_json`,
				`ALTER TABLE scenes DROP COLUMN IF EXISTS behaviors_json`,
				`ALTER TABLE scenes DROP COLUMN IF EXISTS kind`,
			})
		},
	}
}
