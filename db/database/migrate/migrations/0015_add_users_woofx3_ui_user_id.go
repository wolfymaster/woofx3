package migrations

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddUsersWoofx3UIUserID links an engine user row to its corresponding UI
// user identity. The column is nullable because legacy users predate the UI
// onboarding flow; the partial unique index prevents two engine users from
// claiming the same UI identity.
func AddUsersWoofx3UIUserID() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "202604170003_add_users_woofx3_ui_user_id",
		Migrate: func(tx *gorm.DB) error {
			if err := tx.Exec(`
				ALTER TABLE public.users
				ADD COLUMN IF NOT EXISTS woofx3_ui_user_id VARCHAR(100);
			`).Error; err != nil {
				return err
			}
			return tx.Exec(`
				CREATE UNIQUE INDEX IF NOT EXISTS idx_users_woofx3_ui_user_id
				ON public.users (woofx3_ui_user_id) WHERE woofx3_ui_user_id IS NOT NULL;
			`).Error
		},
		Rollback: func(tx *gorm.DB) error {
			if err := tx.Exec(`DROP INDEX IF EXISTS idx_users_woofx3_ui_user_id`).Error; err != nil {
				return err
			}
			return tx.Exec(`ALTER TABLE public.users DROP COLUMN IF EXISTS woofx3_ui_user_id`).Error
		},
	}
}
