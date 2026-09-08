package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
)

// AddFollowerAndTierGroups seeds the built-in catalog again so applications
// created before "follower" and the subscription tier groups existed pick them
// up. See the postgres migration of the same name for the full rationale.
func AddFollowerAndTierGroups() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0034_follower_and_tier_groups",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Seeding follower and subscription tier groups...")

			var appIDs []uuid.UUID
			if err := tx.Raw(`SELECT id FROM applications`).Scan(&appIDs).Error; err != nil {
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
					`DELETE FROM groups WHERE name = ? AND is_built_in = 1`, name,
				).Error; err != nil {
					return err
				}
			}
			return nil
		},
	}
}
