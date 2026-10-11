package sqlite

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddCompositionLinks creates `composition_links`. See the postgres migration
// of the same ID for the shape decisions. Ids are supplied by the repository
// on insert, since SQLite has no `uuid_generate_v4()`.
func AddCompositionLinks() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0061_composition_links",
		Migrate: func(tx *gorm.DB) error {
			return execStatements(tx, []string{
				`CREATE TABLE IF NOT EXISTS composition_links (
					id             TEXT                               NOT NULL PRIMARY KEY,
					composition_id TEXT                               NOT NULL REFERENCES scenes(id) ON UPDATE CASCADE ON DELETE RESTRICT,
					owner_kind     TEXT                               NOT NULL CONSTRAINT composition_links_owner_kind_known CHECK (owner_kind IN ('workflow', 'command')),
					owner_id       TEXT                               NOT NULL CHECK (owner_id <> ''),
					step_id        TEXT                               NOT NULL CHECK (step_id <> ''),
					created_at     DATETIME DEFAULT (datetime('now')) NOT NULL,
					updated_at     DATETIME DEFAULT (datetime('now')) NOT NULL,
					CONSTRAINT uq_composition_links_owner_step UNIQUE (owner_kind, owner_id, step_id)
				)`,
				`CREATE INDEX IF NOT EXISTS idx_composition_links_composition
					ON composition_links (composition_id)`,
			})
		},
		Rollback: func(tx *gorm.DB) error {
			return execStatements(tx, []string{`DROP TABLE IF EXISTS composition_links`})
		},
	}
}
