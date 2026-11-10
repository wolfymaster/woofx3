package postgres

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddModuleMarketplaceLicenseKey records the license key a marketplace module
// was downloaded with: `modules.marketplace_license_key_sealed`, the key
// sealed with the engine's secrets key, because it is a credential that
// downloads the listing.
//
// Nullable with no default: NULL means the module did not come from the
// marketplace, or came without a key (before keys existed, or from a
// marketplace that issued none). The key lives and dies with the module row,
// so uninstalling the module forgets it.
func AddModuleMarketplaceLicenseKey() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0082_module_marketplace_license_key",
		Migrate: func(tx *gorm.DB) error {
			return tx.Exec(`ALTER TABLE public.modules ADD COLUMN IF NOT EXISTS marketplace_license_key_sealed TEXT`).Error
		},
		Rollback: func(tx *gorm.DB) error {
			return tx.Exec(`ALTER TABLE public.modules DROP COLUMN IF EXISTS marketplace_license_key_sealed`).Error
		},
	}
}
