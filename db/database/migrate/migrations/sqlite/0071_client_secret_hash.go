package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddClientSecretHash makes room for client secrets stored as their SHA-256
// hash. See the postgres migration of the same ID for why `client_secret`
// stays for now.
//
// SQLite cannot add a table constraint to an existing table, so both CHECKs
// ride on the new column. Relaxing `client_secret`'s NOT NULL needs the table
// rebuilt (see rebuildTable), which runs with foreign keys disabled and in one
// transaction that checks them before it commits.
func AddClientSecretHash() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0071_client_secret_hash",
		Migrate: func(db *gorm.DB) error {
			log.Println("Adding client_secret_hash to clients...")
			err := withForeignKeysDisabled(db, func(conn *gorm.DB) error {
				return conn.Transaction(func(tx *gorm.DB) error {
					if err := execSQL(tx, `ALTER TABLE clients ADD COLUMN IF NOT EXISTS client_secret_hash TEXT NULL
						CONSTRAINT clients_secret_hash_format CHECK (client_secret_hash IS NULL OR
							(length(client_secret_hash) = 64 AND client_secret_hash NOT GLOB '*[^0-9a-f]*'))
						CONSTRAINT clients_secret_present CHECK (client_secret IS NOT NULL OR client_secret_hash IS NOT NULL)`,
					); err != nil {
						return err
					}
					if err := rebuildTable(tx, tableRebuild{table: "clients", nullable: []string{"client_secret"}}); err != nil {
						return err
					}
					return assertForeignKeysHold(tx)
				})
			})
			if err != nil {
				return err
			}
			log.Println("client_secret_hash migration complete")
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			// Not reversible, as the postgres migration explains. Rollback is
			// a deliberate no-op.
			return nil
		},
	}
}
