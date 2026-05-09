package migrations

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// CreateScenesTable adds the `scenes` table — a per-application bucket
// of widget arrangements that the streamware overlay (and, optionally,
// the Convex scene editor) reads to compose what the browser source
// actually displays.
//
// Like `workflow_definitions`, scenes intentionally use opaque JSONB
// columns rather than typed schemas:
//
//   - `widgets_json` is the array of placed widget instances —
//     `[{ id, widgetCanonicalId, position, settings }, ...]` — each
//     bound to a registered widget canonical id and carrying its
//     per-instance position and settings overrides. The engine does
//     not interpret the contents; the editor and the overlay shell do.
//
//   - `layout_json` is the canvas-level layout (dimensions, grid
//     options, theme) that applies to every widget on the scene.
//     Optional — most scenes will leave it `{}`.
//
// Audit columns mirror `workflow_definitions` for symmetry: scenes
// can be USER-authored (UI scene editor) or MODULE-authored (a future
// manifest field that ships preset scenes alongside widgets). The
// `created_by_type` / `created_by_ref` pair lets the projection layer
// dedupe and route correctly.
func CreateScenesTable() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0006_scenes",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Creating scenes table...")
			statements := []string{
				`CREATE TABLE IF NOT EXISTS public.scenes (
					id              UUID         DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
					application_id  UUID                                    NOT NULL REFERENCES public.applications(id) ON UPDATE CASCADE ON DELETE CASCADE,
					name            VARCHAR(255)                            NOT NULL,
					description     TEXT         DEFAULT ''                 NOT NULL,
					widgets_json    JSONB        DEFAULT '[]'::jsonb        NOT NULL,
					layout_json     JSONB        DEFAULT '{}'::jsonb        NOT NULL,
					created_by_type TEXT         DEFAULT 'USER'             NOT NULL,
					created_by_ref  TEXT         DEFAULT ''                 NOT NULL,
					created_at      TIMESTAMP    DEFAULT NOW()              NOT NULL,
					updated_at      TIMESTAMP    DEFAULT NOW()              NOT NULL
				)`,
				`CREATE INDEX IF NOT EXISTS idx_scenes_application_id
					ON public.scenes (application_id)`,
				`CREATE INDEX IF NOT EXISTS idx_scenes_origin
					ON public.scenes (created_by_type, created_by_ref)`,
				// Prevent duplicate scene names per application — the editor
				// uses (application_id, name) as a human handle for sharing
				// scene URLs ("scene/main"), so collisions break the UX.
				`CREATE UNIQUE INDEX IF NOT EXISTS idx_scenes_application_name
					ON public.scenes (application_id, name)`,
			}
			for _, stmt := range statements {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			log.Println("scenes migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			statements := []string{
				`DROP INDEX IF EXISTS idx_scenes_application_name`,
				`DROP INDEX IF EXISTS idx_scenes_origin`,
				`DROP INDEX IF EXISTS idx_scenes_application_id`,
				`DROP TABLE IF EXISTS public.scenes`,
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
