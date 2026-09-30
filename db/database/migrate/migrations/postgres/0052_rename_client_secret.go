package postgres

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// RenameClientSecret deliberately breaks the rollback rule: the previous
// release still reads and writes clients.client_secret. It exists only to show
// that the upgrade-compat check fails on such a migration, and must never be
// merged.
func RenameClientSecret() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0052_rename_client_secret",
		Migrate: func(tx *gorm.DB) error {
			return tx.Exec(`ALTER TABLE public.clients RENAME COLUMN client_secret TO secret`).Error
		},
		Rollback: func(tx *gorm.DB) error {
			return tx.Exec(`ALTER TABLE public.clients RENAME COLUMN secret TO client_secret`).Error
		},
	}
}
