package sqlite

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddSceneEditorState adds `scenes.editor_state_json`. See the postgres
// migration of the same ID.
func AddSceneEditorState() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0056_scene_editor_state",
		Migrate: func(tx *gorm.DB) error {
			return execSQL(tx, `ALTER TABLE scenes ADD COLUMN IF NOT EXISTS editor_state_json TEXT`)
		},
		Rollback: func(tx *gorm.DB) error {
			return execSQL(tx, `ALTER TABLE scenes DROP COLUMN IF EXISTS editor_state_json`)
		},
	}
}
