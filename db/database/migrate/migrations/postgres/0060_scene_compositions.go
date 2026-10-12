package postgres

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddSceneCompositions makes a scene row hold any composition, a scene or an
// alert, with everything its document has: the behaviors (transitions,
// effects, activity windows) of the published document and of the draft, and
// the inputs a step that uses the composition fills in.
//
//   - `kind` is "scene" or "alert" and never changes after creation. Every
//     existing row is a scene. Readers that serve overlays, deliver alerts or
//     list scenes filter on it, so an alert is never shown as a page.
//   - Names are unique per kind rather than across the table, so an alert
//     may share a name with a scene.
//   - `draft_behaviors_json` is NULL exactly when the draft documents are;
//     a draft stored before the column existed reads as one with no
//     behaviors, which is what it had.
//   - Inputs are not drafted: the scene editor never changes them, so the
//     published and draft documents always declare the same inputs.
func AddSceneCompositions() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0060_scene_compositions",
		Migrate: func(tx *gorm.DB) error {
			statements := []string{
				`ALTER TABLE public.scenes ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'scene'
					CONSTRAINT scenes_kind_known CHECK (kind IN ('scene', 'alert'))`,
				`ALTER TABLE public.scenes ADD COLUMN IF NOT EXISTS behaviors_json JSONB NOT NULL DEFAULT '{}'`,
				`ALTER TABLE public.scenes ADD COLUMN IF NOT EXISTS draft_behaviors_json JSONB`,
				`ALTER TABLE public.scenes ADD COLUMN IF NOT EXISTS inputs_json JSONB NOT NULL DEFAULT '[]'`,
				`DROP INDEX IF EXISTS public.idx_scenes_name`,
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_scenes_kind_name ON public.scenes (kind, name)`,
			}
			for _, stmt := range statements {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			return nil
		},
		// Deletes every alert: without `kind` it would read as a scene and be
		// served as an overlay page. The scenes left have unique names, so the
		// table-wide index can come back.
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`DROP INDEX IF EXISTS public.idx_scenes_kind_name`,
				`DELETE FROM public.scenes WHERE kind <> 'scene'`,
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_scenes_name ON public.scenes (name)`,
				`ALTER TABLE public.scenes DROP COLUMN IF EXISTS inputs_json`,
				`ALTER TABLE public.scenes DROP COLUMN IF EXISTS draft_behaviors_json`,
				`ALTER TABLE public.scenes DROP COLUMN IF EXISTS behaviors_json`,
				`ALTER TABLE public.scenes DROP COLUMN IF EXISTS kind`,
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
