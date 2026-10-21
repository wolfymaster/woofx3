package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/wolfymaster/woofx3/db/database/migrate/migrations/commandgrants"
	"gorm.io/gorm"
)

// RevokeUngrantedCommandWildcards removes the wildcard allow from restricted
// commands nobody was granted, closing streamer-created ones and making
// module-registered ones public. See the commandgrants package for why.
func RevokeUngrantedCommandWildcards() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0069_revoke_ungranted_command_wildcards",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Revoking the wildcard allow of restricted commands with no grant...")
			outcome, err := commandgrants.SettleUngrantedRestricted(tx, commandgrants.Tables{
				Commands: "commands", CommandGroups: "command_groups", CommandUsers: "command_users", Permissions: "permissions",
			})
			if err != nil {
				return err
			}
			for _, name := range outcome.Revoked {
				log.Printf("Command %q is restricted with no grant: nobody may use it until it is granted", name)
			}
			for _, name := range outcome.Published {
				log.Printf("Module command %q was restricted with no grant: it is now public, as it effectively was", name)
			}
			log.Printf("Revoked the wildcard allow of %d command(s); made %d module command(s) public",
				len(outcome.Revoked), len(outcome.Published))
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			// Not reversible: which commands had the rule, or were made public,
			// is not recorded, and restoring the rule would reopen streamer
			// commands to every chatter.
			return nil
		},
	}
}
