package postgres

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddClientSecretHash makes room for client secrets stored as their SHA-256
// hash (lowercase hex) instead of in plain text.
//
// This is the expand step only. `client_secret` stays, now nullable: a
// client this release creates has only a hash, while existing clients keep
// their plain text beside the hash db-proxy computes for them at startup
// (services.HashStoredClientSecrets). The previous release validates against
// `client_secret`, so the plain text has to outlive one release for a
// rollback to keep every existing client working; a later release clears it
// and drops the column.
//
// Every client has a secret in one form or the other
// (clients_secret_present), and a hash is 64 lowercase hex digits
// (clients_secret_hash_format). Rows the previous release writes have plain
// text and no hash, which both allow.
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
			// Not reversible: a client created since has no plain-text secret,
			// so client_secret cannot become NOT NULL again, and without the
			// hash it could never authenticate. Rollback is a deliberate no-op.
			return nil
		},
	}
}
