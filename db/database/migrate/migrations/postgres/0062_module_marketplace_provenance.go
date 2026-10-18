package postgres

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddModuleMarketplaceProvenance records which marketplace listing a module
// was installed from: `modules.marketplace_listing_id` and
// `modules.marketplace_edition`.
//
// The module key's first segment is the manifest id, which a later edition
// of a listing shares with the earlier ones, so the key alone cannot say
// which listing (and so which entitlement) an install came from.
//
// Both are nullable with no default: NULL means the module did not come from
// the marketplace, or was installed before the engine recorded it, and a
// reader must treat the two alike.
func AddModuleMarketplaceProvenance() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0062_module_marketplace_provenance",
		Migrate: func(tx *gorm.DB) error {
			for _, stmt := range []string{
				`ALTER TABLE public.modules ADD COLUMN IF NOT EXISTS marketplace_listing_id TEXT`,
				`ALTER TABLE public.modules ADD COLUMN IF NOT EXISTS marketplace_edition INTEGER`,
			} {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			for _, stmt := range []string{
				`ALTER TABLE public.modules DROP COLUMN IF EXISTS marketplace_edition`,
				`ALTER TABLE public.modules DROP COLUMN IF EXISTS marketplace_listing_id`,
			} {
				if err := tx.Exec(stmt).Error; err != nil {
					return err
				}
			}
			return nil
		},
	}
}
