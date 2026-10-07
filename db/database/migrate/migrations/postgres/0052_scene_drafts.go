package postgres

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddSceneDrafts gives a scene a draft: the editor's edits are kept beside the
// published widgets and layout until they are published or discarded, so an
// overlay in OBS keeps showing the published scene while the streamer edits.
//
// NULL means no draft: the scene's draft is the published scene.
func AddSceneDrafts() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0052_scene_drafts",
		Migrate: func(tx *gorm.DB) error {
			if err := tx.Exec(`ALTER TABLE public.scenes ADD COLUMN IF NOT EXISTS draft_widgets_json JSONB`).Error; err != nil {
				return err
			}
			return tx.Exec(`ALTER TABLE public.scenes ADD COLUMN IF NOT EXISTS draft_layout_json JSONB`).Error
		},
		Rollback: func(tx *gorm.DB) error {
			if err := tx.Exec(`ALTER TABLE public.scenes DROP COLUMN IF EXISTS draft_layout_json`).Error; err != nil {
				return err
			}
			return tx.Exec(`ALTER TABLE public.scenes DROP COLUMN IF EXISTS draft_widgets_json`).Error
		},
	}
}
