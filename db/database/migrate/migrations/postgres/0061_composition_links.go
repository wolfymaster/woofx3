package postgres

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddCompositionLinks creates `composition_links`: which workflow or chat
// command step plays which composition. A step refers to an alert by id and
// always plays its latest published version, so the engine keeps these
// edges to refuse deleting an alert that steps still play and to show where
// an alert is used.
//
//   - An owner (a workflow or a command) replaces all of its links at once
//     when it is saved, so the table always matches the saved definitions.
//   - A step plays at most one composition: (owner_kind, owner_id, step_id)
//     is unique.
//   - Deleting a composition that still has links is refused (RESTRICT);
//     the service refuses it first, naming the steps.
//   - `owner_id` is TEXT: owners are identified by whatever id their own
//     table uses, and this table must not depend on either.
func AddCompositionLinks() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0061_composition_links",
		Migrate: func(tx *gorm.DB) error {
			statements := []string{
				`CREATE TABLE IF NOT EXISTS public.composition_links (
					id             UUID        DEFAULT uuid_generate_v4() NOT NULL PRIMARY KEY,
					composition_id UUID                                   NOT NULL REFERENCES public.scenes(id) ON UPDATE CASCADE ON DELETE RESTRICT,
					owner_kind     TEXT                                   NOT NULL CONSTRAINT composition_links_owner_kind_known CHECK (owner_kind IN ('workflow', 'command')),
					owner_id       TEXT                                   NOT NULL CHECK (owner_id <> ''),
					step_id        TEXT                                   NOT NULL CHECK (step_id <> ''),
					created_at     TIMESTAMPTZ DEFAULT NOW()              NOT NULL,
					updated_at     TIMESTAMPTZ DEFAULT NOW()              NOT NULL,
					CONSTRAINT uq_composition_links_owner_step UNIQUE (owner_kind, owner_id, step_id)
				)`,
				`CREATE INDEX IF NOT EXISTS idx_composition_links_composition
					ON public.composition_links (composition_id)`,
			}
			for _, stmt := range statements {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return tx.Exec(`DROP TABLE IF EXISTS public.composition_links`).Error
		},
	}
}
