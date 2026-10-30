package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// clientCreatedAtUnknown is the placeholder `created_at` default. SQLite's
// ADD COLUMN accepts only a constant default, so the column is added with this
// one and every existing row is then stamped with the migration time. This
// release sets `created_at` on every insert; only a client created by the
// previous release, run on this schema after a rollback, keeps the
// placeholder.
const clientCreatedAtUnknown = "1970-01-01 00:00:00"

// AddClientKindOrigin records how each client came to exist and when. See the
// postgres migration of the same ID for the meaning of each column. SQLite
// cannot add a table constraint to an existing table, so the two CHECKs ride
// on the columns they constrain; `origin`'s is added after `kind` exists.
func AddClientKindOrigin() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0074_client_kind_origin",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding kind, origin and timestamps to clients...")
			if err := execStatements(tx, []string{
				`ALTER TABLE clients ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'registered'
					CONSTRAINT clients_kind_known CHECK (kind IN ('registered', 'paired'))`,
				`ALTER TABLE clients ADD COLUMN IF NOT EXISTS origin TEXT NULL
					CONSTRAINT clients_origin_matches_kind CHECK ((kind = 'paired') = (origin IS NOT NULL))`,
				`ALTER TABLE clients ADD COLUMN IF NOT EXISTS created_at DATETIME NOT NULL DEFAULT '` + clientCreatedAtUnknown + `'`,
				`ALTER TABLE clients ADD COLUMN IF NOT EXISTS last_authenticated_at DATETIME NULL`,
			}); err != nil {
				return err
			}
			if err := tx.Exec(
				`UPDATE clients SET created_at = datetime('now') WHERE created_at = ?`, clientCreatedAtUnknown,
			).Error; err != nil {
				return err
			}
			log.Println("clients kind and origin migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			// origin's CHECK names kind, so origin goes first.
			return execStatements(tx, []string{
				`ALTER TABLE clients DROP COLUMN IF EXISTS last_authenticated_at`,
				`ALTER TABLE clients DROP COLUMN IF EXISTS created_at`,
				`ALTER TABLE clients DROP COLUMN IF EXISTS origin`,
				`ALTER TABLE clients DROP COLUMN IF EXISTS kind`,
			})
		},
	}
}
