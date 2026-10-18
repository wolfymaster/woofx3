package sqlite

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

// AddModuleMarketplaceProvenance adds `modules.marketplace_listing_id` and
// `modules.marketplace_edition`. See the postgres migration of the same ID.
func AddModuleMarketplaceProvenance() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0062_module_marketplace_provenance",
		Migrate: func(tx *gorm.DB) error {
			for _, stmt := range []string{
				`ALTER TABLE modules ADD COLUMN IF NOT EXISTS marketplace_listing_id TEXT`,
				`ALTER TABLE modules ADD COLUMN IF NOT EXISTS marketplace_edition INTEGER`,
			} {
				if err := execSQL(tx, stmt); err != nil {
					return err
				}
			}
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			for _, stmt := range []string{
				`ALTER TABLE modules DROP COLUMN IF EXISTS marketplace_edition`,
				`ALTER TABLE modules DROP COLUMN IF EXISTS marketplace_listing_id`,
			} {
				if err := execSQL(tx, stmt); err != nil {
					return err
				}
			}
			return nil
		},
	}
}
