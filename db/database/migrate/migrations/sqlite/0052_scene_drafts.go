package sqlite

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddSceneDrafts adds `scenes.draft_widgets_json` and `scenes.draft_layout_json`.
// See the postgres migration of the same ID.
func AddSceneDrafts() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0052_scene_drafts",
		Migrate: func(tx *gorm.DB) error {
			if err := execSQL(tx, `ALTER TABLE scenes ADD COLUMN IF NOT EXISTS draft_widgets_json TEXT`); err != nil {
				return err
			}
			return execSQL(tx, `ALTER TABLE scenes ADD COLUMN IF NOT EXISTS draft_layout_json TEXT`)
		},
		Rollback: func(tx *gorm.DB) error {
			if err := execSQL(tx, `ALTER TABLE scenes DROP COLUMN IF EXISTS draft_layout_json`); err != nil {
				return err
			}
			return execSQL(tx, `ALTER TABLE scenes DROP COLUMN IF EXISTS draft_widgets_json`)
		},
	}
}
