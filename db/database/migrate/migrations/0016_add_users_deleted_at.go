package migrations

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddUsersDeletedAt adds the soft-delete column referenced by the User model
// (models.User.DeletedAt) and the user repository's `deleted_at IS NULL`
// filters. Without this column every read through the user repository fails
// with `column "deleted_at" does not exist`, which previously manifested as
// an opaque capnweb serialization error at the UI.
func AddUsersDeletedAt() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "202604190001_add_users_deleted_at",
		Migrate: func(tx *gorm.DB) error {
			if err := tx.Exec(`
				ALTER TABLE public.users
				ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
			`).Error; err != nil {
				return err
			}
			return tx.Exec(`
				CREATE INDEX IF NOT EXISTS idx_users_deleted_at
				ON public.users (deleted_at);
			`).Error
		},
		Rollback: func(tx *gorm.DB) error {
			if err := tx.Exec(`DROP INDEX IF EXISTS idx_users_deleted_at`).Error; err != nil {
				return err
			}
			return tx.Exec(`ALTER TABLE public.users DROP COLUMN IF EXISTS deleted_at`).Error
		},
	}
}
