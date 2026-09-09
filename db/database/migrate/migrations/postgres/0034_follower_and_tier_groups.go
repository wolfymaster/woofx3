package postgres

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
)

// AddFollowerAndTierGroups seeds the built-in catalog again so applications
// created before "follower" and the subscription tier groups existed pick them
// up. New applications get them from services.SeedBuiltInGroups; 0032 only ran
// against the catalog as it stood then.
//
// seedBuiltInGroupsSQL is idempotent and reads models.BuiltInGroups, so this
// adds exactly the groups that are missing and leaves the rest untouched -
// including any same-named group an operator made by hand, which it promotes
// rather than duplicating.
//
// Rollback deletes only the groups this migration can have added. It cannot
// simply drop every built-in group, since 0032's built-ins predate it.
func AddFollowerAndTierGroups() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0034_follower_and_tier_groups",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Seeding follower and subscription tier groups...")

			var appIDs []uuid.UUID
			if err := tx.Raw(`SELECT id FROM public.applications`).Scan(&appIDs).Error; err != nil {
				return err
			}
			for _, appID := range appIDs {
				if err := seedBuiltInGroupsSQL(tx, appID); err != nil {
					return err
				}
			}
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			added := []string{
				models.GroupFollower,
				models.GroupSubscriberTier1,
				models.GroupSubscriberTier2,
				models.GroupSubscriberTier3,
			}
			for _, name := range added {
				if err := tx.Exec(
					`DELETE FROM public.groups WHERE name = ? AND is_built_in = TRUE`, name,
				).Error; err != nil {
					return err
				}
			}
			return nil
		},
	}
}
