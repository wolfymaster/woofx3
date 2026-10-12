package postgres

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddSceneEditorState gives a scene the scene editor's sync state: the
// sequence position the editors have reached and each editor's last
// acknowledged item. It is saved in the same row update as the published
// and draft documents, so after a restart the documents and the position
// they correspond to agree.
//
// NULL means no editor has synced the scene yet. TEXT rather than JSONB:
// the engine owns the format and reads back exactly what it wrote, and
// JSONB would reorder keys and reformat the text.
func AddSceneEditorState() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0056_scene_editor_state",
		Migrate: func(tx *gorm.DB) error {
			return tx.Exec(`ALTER TABLE public.scenes ADD COLUMN IF NOT EXISTS editor_state_json TEXT`).Error
		},
		Rollback: func(tx *gorm.DB) error {
			return tx.Exec(`ALTER TABLE public.scenes DROP COLUMN IF EXISTS editor_state_json`).Error
		},
	}
}
