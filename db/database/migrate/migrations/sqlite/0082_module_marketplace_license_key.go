package sqlite

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddModuleMarketplaceLicenseKey adds `modules.marketplace_license_key_sealed`.
// See the postgres migration of the same ID.
func AddModuleMarketplaceLicenseKey() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0082_module_marketplace_license_key",
		Migrate: func(tx *gorm.DB) error {
			return execSQL(tx, `ALTER TABLE modules ADD COLUMN IF NOT EXISTS marketplace_license_key_sealed TEXT`)
		},
		Rollback: func(tx *gorm.DB) error {
			return execSQL(tx, `ALTER TABLE modules DROP COLUMN IF EXISTS marketplace_license_key_sealed`)
		},
	}
}
