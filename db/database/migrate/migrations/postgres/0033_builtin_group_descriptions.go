package postgres

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
)

// RefreshBuiltInGroupDescriptions rewrites the seeded descriptions of built-in
// groups to the platform-neutral wording in models.BuiltInGroups.
//
// The descriptions are user-visible: they are mirrored into the control plane
// and rendered in its Groups view. Seeding (services.SeedBuiltInGroups) only
// writes a description when it creates the row, so applications seeded before
// this point keep whatever text shipped at the time - which named Twitch
// explicitly. Groups describe roles a chat platform may report, and nothing in
// the grouping model is specific to one platform, so the old wording is both
// inaccurate and misleading once a second platform exists.
//
// Matched by name and is_built_in so a custom group that happens to share a
// name is never touched.
func RefreshBuiltInGroupDescriptions() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0033_builtin_group_descriptions",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Refreshing built-in group descriptions...")
			for _, g := range models.BuiltInGroups {
				if err := tx.Exec(
					`UPDATE public.groups SET description = ? WHERE name = ? AND is_built_in = TRUE`,
					g.Description, g.Name,
				).Error; err != nil {
					return err
				}
			}
			return nil
		},
		// No rollback: the previous descriptions were cosmetic text, and
		// restoring them would mean re-introducing wording this migration
		// exists to remove.
		Rollback: func(tx *gorm.DB) error { return nil },
	}
}
