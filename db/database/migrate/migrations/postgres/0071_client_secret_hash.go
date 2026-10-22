package postgres

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddClientSecretHash stores client secrets as their SHA-256 hash (lowercase
// hex) instead of in plain text.
//
// The migration changes only the schema. db-proxy hashes every stored
// plain-text secret and clears it at startup, before it serves
// (services.HashStoredClientSecrets), so no secret stays in plain text.
//
// `client_secret` becomes nullable rather than being dropped, so an older
// release can still start on this schema and register clients after a
// rollback. It cannot authenticate any client that existed before, because
// it validates against the plain text db-proxy clears
// (docs/operations/releases.md). The plain text an older release writes is
// hashed and cleared on the next start of this one.
//
// Every client has a secret in one form or the other
// (clients_secret_present), and a hash is 64 lowercase hex digits
// (clients_secret_hash_format). Rows an older release writes have plain text
// and no hash, which both allow.
func AddClientSecretHash() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0071_client_secret_hash",
		Migrate: func(db *gorm.DB) error {
			log.Println("Adding client_secret_hash to clients...")
			err := db.Transaction(func(tx *gorm.DB) error {
				for _, stmt := range []string{
					`ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS client_secret_hash TEXT NULL`,
					`ALTER TABLE public.clients ALTER COLUMN client_secret DROP NOT NULL`,
					`ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_secret_hash_format`,
					`ALTER TABLE public.clients ADD CONSTRAINT clients_secret_hash_format
						CHECK (client_secret_hash IS NULL OR client_secret_hash ~ '^[0-9a-f]{64}$')`,
					`ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_secret_present`,
					`ALTER TABLE public.clients ADD CONSTRAINT clients_secret_present
						CHECK (client_secret IS NOT NULL OR client_secret_hash IS NOT NULL)`,
				} {
					if err := tx.Exec(stmt).Error; err != nil {
						return err
					}
				}
				return nil
			})
			if err != nil {
				return err
			}
			log.Println("client_secret_hash migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			// Not reversible: no client has a plain-text secret any more, so
			// client_secret cannot become NOT NULL again, and without the hash
			// no client could authenticate. Rollback is a deliberate no-op.
			return nil
		},
	}
}
