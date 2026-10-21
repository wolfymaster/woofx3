// Package commandgrants closes the wildcard allow that restricted commands
// with no grant used to be stored with. Shared by the postgres and sqlite
// migrations.
//
// A restricted command may be invoked only by the groups and users granted
// it. One with neither grant was once given a `*` read rule, which let every
// chatter use it, while the dashboard showed it as usable by no one.
//
// Commands a streamer created get the rule removed, so the policy matches
// what the dashboard shows: nobody may use the command until it is granted
// to someone.
//
// Commands a module registered are made public instead. Modules used to
// register every command restricted with no grant, and re-registering an
// existing module command never rewrites its permissions, so removing the
// rule would switch off every installed module command for good. Public
// keeps them answering everyone, as they did, and is what a manifest command
// without a required role registers as today. Public commands need no policy
// rows, so the `*` rule is removed for them too.
//
// A restricted command granted to the built-in "everyone" group keeps its
// `*` rule, because that grant has a command_groups row.
package commandgrants

import (
	"fmt"

	"gorm.io/gorm"
)

// Tables names the tables the migration reads and writes, qualified as the
// dialect needs.
type Tables struct {
	Commands      string
	CommandGroups string
	CommandUsers  string
	Permissions   string
}

// Outcome names the commands the migration changed.
type Outcome struct {
	// Revoked are streamer-created commands that nobody may use until granted.
	Revoked []string
	// Published are module-registered commands that are now public.
	Published []string
}

// moduleCreatedBy is the created_by_type of a command a module registered.
// Must match the value barkloader sends and CreateCommand checks.
const moduleCreatedBy = "MODULE"

type ungrantedCommand struct {
	ID            string
	Command       string
	CreatedByType string
}

// SettleUngrantedRestricted removes the `*` read rule of every restricted
// command with no group and no user grant, and makes the module-registered
// ones public. Running it again finds nothing to change.
func SettleUngrantedRestricted(tx *gorm.DB, tables Tables) (Outcome, error) {
	ungranted := fmt.Sprintf(`
		SELECT c.id, c.command, c.created_by_type FROM %[1]s c
		WHERE c.visibility = 'restricted'
		  AND NOT EXISTS (SELECT 1 FROM %[2]s g WHERE g.command_id = c.id)
		  AND NOT EXISTS (SELECT 1 FROM %[3]s u WHERE u.command_id = c.id)
		  AND EXISTS (
		    SELECT 1 FROM %[4]s p
		    WHERE p.ptype = 'p' AND p.v0 = '*' AND p.v1 = 'command/' || c.command AND p.v2 = 'read'
		  )
		ORDER BY c.command`,
		tables.Commands, tables.CommandGroups, tables.CommandUsers, tables.Permissions)

	var commands []ungrantedCommand
	if err := tx.Raw(ungranted).Scan(&commands).Error; err != nil {
		return Outcome{}, fmt.Errorf("list ungranted restricted commands: %w", err)
	}

	var outcome Outcome
	for _, c := range commands {
		if c.CreatedByType == moduleCreatedBy {
			err := tx.Exec(fmt.Sprintf(`UPDATE %s SET visibility = 'public' WHERE id = ?`, tables.Commands), c.ID).Error
			if err != nil {
				return Outcome{}, fmt.Errorf("make module command %q public: %w", c.Command, err)
			}
			outcome.Published = append(outcome.Published, c.Command)
		} else {
			outcome.Revoked = append(outcome.Revoked, c.Command)
		}
		err := tx.Exec(
			fmt.Sprintf(`DELETE FROM %s WHERE ptype = 'p' AND v0 = '*' AND v1 = ? AND v2 = 'read'`, tables.Permissions),
			"command/"+c.Command,
		).Error
		if err != nil {
			return Outcome{}, fmt.Errorf("remove the wildcard rule of command %q: %w", c.Command, err)
		}
	}
	return outcome, nil
}
