// Package commandgrants closes the wildcard allow that restricted commands
// with no grant used to be stored with. Shared by the postgres and sqlite
// migrations.
//
// A restricted command may be invoked only by the groups and users granted
// it. One with neither grant was once given a `*` read rule, which let every
// chatter use it, while the dashboard showed it as usable by no one. The
// rule is removed so the policy matches what the streamer sees: nobody may
// use the command until they grant it to someone. A restricted command
// granted to the built-in "everyone" group keeps its `*` rule, because that
// grant has a command_groups row.
package commandgrants

import (
	"fmt"

	"gorm.io/gorm"
)

// Tables names the tables the revocation reads and writes, qualified as the
// dialect needs.
type Tables struct {
	Commands      string
	CommandGroups string
	CommandUsers  string
	Permissions   string
}

// RevokeUngrantedWildcards deletes the `*` read rule of every restricted
// command with no group and no user grant, and returns the names of the
// commands it changed. Running it again finds nothing to change.
func RevokeUngrantedWildcards(tx *gorm.DB, tables Tables) ([]string, error) {
	ungranted := fmt.Sprintf(`
		SELECT c.command FROM %[1]s c
		WHERE c.visibility = 'restricted'
		  AND NOT EXISTS (SELECT 1 FROM %[2]s g WHERE g.command_id = c.id)
		  AND NOT EXISTS (SELECT 1 FROM %[3]s u WHERE u.command_id = c.id)
		  AND EXISTS (
		    SELECT 1 FROM %[4]s p
		    WHERE p.ptype = 'p' AND p.v0 = '*' AND p.v1 = 'command/' || c.command AND p.v2 = 'read'
		  )
		ORDER BY c.command`,
		tables.Commands, tables.CommandGroups, tables.CommandUsers, tables.Permissions)

	var names []string
	if err := tx.Raw(ungranted).Scan(&names).Error; err != nil {
		return nil, fmt.Errorf("list ungranted restricted commands: %w", err)
	}
	for _, name := range names {
		err := tx.Exec(
			fmt.Sprintf(`DELETE FROM %s WHERE ptype = 'p' AND v0 = '*' AND v1 = ? AND v2 = 'read'`, tables.Permissions),
			"command/"+name,
		).Error
		if err != nil {
			return nil, fmt.Errorf("revoke the wildcard rule of command %q: %w", name, err)
		}
	}
	return names, nil
}
