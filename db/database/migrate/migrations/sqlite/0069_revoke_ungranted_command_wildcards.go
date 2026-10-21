package sqlite

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/wolfymaster/woofx3/db/database/migrate/migrations/commandgrants"
	"gorm.io/gorm"
)

// RevokeUngrantedCommandWildcards removes the wildcard allow from restricted
// commands nobody was granted. See the commandgrants package for why.
func RevokeUngrantedCommandWildcards() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0069_revoke_ungranted_command_wildcards",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Revoking the wildcard allow of restricted commands with no grant...")
			names, err := commandgrants.RevokeUngrantedWildcards(tx, commandgrants.Tables{
				Commands: "commands", CommandGroups: "command_groups", CommandUsers: "command_users", Permissions: "permissions",
			})
			if err != nil {
				return err
			}
			for _, name := range names {
				log.Printf("Command %q is restricted with no grant: nobody may use it until it is granted", name)
			}
			log.Printf("Revoked the wildcard allow of %d command(s)", len(names))
			return nil
		},
		Rollback: func(tx *gorm.DB) error {
			// Not reversible: which commands had the rule is not recorded, and
			// restoring it would reopen them to every chatter.
			return nil
		},
	}
}
