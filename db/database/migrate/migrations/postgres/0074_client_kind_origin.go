package postgres

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddClientKindOrigin records how each client came to exist and when.
//
//   - `kind` is `registered` for a client that called registerClient (a
//     desktop shell, a cloud dashboard, a CLI) and `paired` for one a browser
//     obtained through pairing. Every existing client registered.
//
//   - `origin` is the web origin a paired client is bound to. Only a paired
//     client has one, and every paired client has one, which the
//     clients_origin_matches_kind constraint holds.
//
//   - `created_at` of a client that existed before this migration is the
//     time of the migration: the real time was never recorded.
//
//   - `last_authenticated_at` is null until the api records an
//     authentication.
//
// Each constraint is dropped and re-added, so running the migration again
// converges on the same schema.
func AddClientKindOrigin() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0074_client_kind_origin",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Adding kind, origin and timestamps to clients...")
			for _, stmt := range []string{
				`ALTER TABLE public.clients
					ADD COLUMN IF NOT EXISTS kind                  TEXT        NOT NULL DEFAULT 'registered',
					ADD COLUMN IF NOT EXISTS origin                TEXT        NULL,
					ADD COLUMN IF NOT EXISTS created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
					ADD COLUMN IF NOT EXISTS last_authenticated_at TIMESTAMPTZ NULL`,
				`ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_kind_known`,
				`ALTER TABLE public.clients ADD CONSTRAINT clients_kind_known CHECK (kind IN ('registered', 'paired'))`,
				`ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_origin_matches_kind`,
				`ALTER TABLE public.clients
					ADD CONSTRAINT clients_origin_matches_kind CHECK ((kind = 'paired') = (origin IS NOT NULL))`,
			} {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			log.Println("clients kind and origin migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			return tx.Exec(`ALTER TABLE public.clients
				DROP CONSTRAINT IF EXISTS clients_origin_matches_kind,
				DROP CONSTRAINT IF EXISTS clients_kind_known,
				DROP COLUMN IF EXISTS last_authenticated_at,
				DROP COLUMN IF EXISTS created_at,
				DROP COLUMN IF EXISTS origin,
				DROP COLUMN IF EXISTS kind`).Error
		},
	}
}
