package migrations

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

func AddClientCallbackUrl() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "202604120001_add_client_callback_url",
		Migrate: func(tx *gorm.DB) error {
			if err := tx.Exec(`ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS callback_url VARCHAR(255) DEFAULT '';`).Error; err != nil {
				return err
			}
			if err := tx.Exec(`ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS callback_token VARCHAR(255) DEFAULT '';`).Error; err != nil {
				return err
			}
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			if err := tx.Exec(`ALTER TABLE public.clients DROP COLUMN IF EXISTS callback_token;`).Error; err != nil {
				return err
			}
			if err := tx.Exec(`ALTER TABLE public.clients DROP COLUMN IF EXISTS callback_url;`).Error; err != nil {
				return err
			}
			return nil
		},
	}
}
