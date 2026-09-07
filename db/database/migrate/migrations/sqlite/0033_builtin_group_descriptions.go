package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
)

// RefreshBuiltInGroupDescriptions rewrites the seeded descriptions of built-in
// groups to the platform-neutral wording in models.BuiltInGroups. See the
// postgres migration of the same name for the full rationale: the descriptions
// are user-visible, seeding only writes them at row creation, and the previous
// text named Twitch explicitly even though nothing in the grouping model is
// specific to one platform.
func RefreshBuiltInGroupDescriptions() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0033_builtin_group_descriptions",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Refreshing built-in group descriptions...")
			for _, g := range models.BuiltInGroups {
				if err := tx.Exec(
					`UPDATE groups SET description = ? WHERE name = ? AND is_built_in = 1`,
					g.Description, g.Name,
				).Error; err != nil {
					return err
				}
			}
			return nil
		},
		Rollback: func(tx *gorm.DB) error { return nil },
	}
}
