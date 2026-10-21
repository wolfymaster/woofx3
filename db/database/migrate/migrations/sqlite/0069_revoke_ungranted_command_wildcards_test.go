package sqlite

import (
	"testing"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
)

const (
	ungrantedCommandID = "00000000-0000-0000-0000-0000000c0001"
	groupGrantedID     = "00000000-0000-0000-0000-0000000c0002"
	userGrantedID      = "00000000-0000-0000-0000-0000000c0003"
	publicCommandID    = "00000000-0000-0000-0000-0000000c0004"
	moduleCommandID    = "00000000-0000-0000-0000-0000000c0005"
	everyoneGroupID    = "00000000-0000-0000-0000-0000000d0001"
)

// seedCommandGrants writes one restricted command of each grant shape, each
// carrying the `*` rule an ungranted restricted command used to be given.
func seedCommandGrants(t *testing.T, db *gorm.DB) {
	t.Helper()
	commands := []struct{ id, name, visibility, createdBy string }{
		{ungrantedCommandID, "song", "restricted", "USER"},
		{groupGrantedID, "hello", "restricted", "USER"},
		{userGrantedID, "secret", "restricted", "USER"},
		{publicCommandID, "uptime", "public", "USER"},
		{moduleCommandID, "lurk", "restricted", "MODULE"},
	}
	for _, c := range commands {
		mustExec(t, db, `INSERT INTO commands (id, command, visibility, created_by_type) VALUES (?, ?, ?, ?)`,
			c.id, c.name, c.visibility, c.createdBy)
		mustExec(t, db, `INSERT INTO permissions (ptype, v0, v1, v2, v3) VALUES ('p', '*', ?, 'read', 'allow')`,
			"command/"+c.name)
	}
	mustExec(t, db, `INSERT OR IGNORE INTO groups (id, name, is_built_in) VALUES (?, 'everyone', 1)`, everyoneGroupID)
	mustExec(t, db, `INSERT INTO command_groups (command_id, group_id) SELECT ?, id FROM groups WHERE name = 'everyone'`,
		groupGrantedID)
	mustExec(t, db, `INSERT INTO command_users (command_id, username) VALUES (?, 'wolfymaster')`, userGrantedID)
	mustExec(t, db, `INSERT INTO permissions (ptype, v0, v1, v2, v3) VALUES ('p', 'wolfymaster', 'command/secret', 'read', 'allow')`)
}

func wildcardRules(t *testing.T, db *gorm.DB, command string) int64 {
	t.Helper()
	return count(t, db, `SELECT COUNT(*) FROM permissions WHERE ptype = 'p' AND v0 = '*' AND v1 = ?`, "command/"+command)
}

func visibility(t *testing.T, db *gorm.DB, id string) string {
	t.Helper()
	var v string
	if err := db.Raw(`SELECT visibility FROM commands WHERE id = ?`, id).Scan(&v).Error; err != nil {
		t.Fatalf("read visibility of %s: %v", id, err)
	}
	return v
}

func TestRevokeUngrantedCommandWildcardsClosesOnlyUngrantedCommands(t *testing.T) {
	db := openMigratedTo(t, "0068_local_ui_settings")
	seedCommandGrants(t, db)

	if err := migrateAll(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	if n := wildcardRules(t, db, "song"); n != 0 {
		t.Errorf("the ungranted restricted command kept %d wildcard rule(s)", n)
	}
	for _, kept := range []string{"hello", "secret", "uptime"} {
		if n := wildcardRules(t, db, kept); n != 1 {
			t.Errorf("command %s has %d wildcard rule(s), want its rule left alone", kept, n)
		}
	}
	if n := count(t, db, `SELECT COUNT(*) FROM permissions WHERE v0 = 'wolfymaster'`); n != 1 {
		t.Errorf("the user grant's rule was touched: %d row(s)", n)
	}
	if v := visibility(t, db, ungrantedCommandID); v != "restricted" {
		t.Errorf("the ungranted streamer command became %q, want it kept restricted", v)
	}
}

func TestRevokeUngrantedCommandWildcardsPublishesUngrantedModuleCommands(t *testing.T) {
	db := openMigratedTo(t, "0068_local_ui_settings")
	seedCommandGrants(t, db)

	if err := migrateAll(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	if v := visibility(t, db, moduleCommandID); v != "public" {
		t.Errorf("the ungranted module command is %q, want public so it keeps answering everyone", v)
	}
	if n := wildcardRules(t, db, "lurk"); n != 0 {
		t.Errorf("the published module command kept %d wildcard rule(s); public commands need none", n)
	}
}

func TestRevokeUngrantedCommandWildcardsRunsAgainWithoutChange(t *testing.T) {
	db := openMigratedTo(t, "0069_revoke_ungranted_command_wildcards")
	seedCommandGrants(t, db)

	migrator := gormigrate.New(db, gormigrate.DefaultOptions, All())
	for run := 1; run <= 2; run++ {
		if err := migrator.RollbackTo("0068_local_ui_settings"); err != nil {
			t.Fatalf("run %d: rollback: %v", run, err)
		}
		if err := migrator.MigrateTo("0069_revoke_ungranted_command_wildcards"); err != nil {
			t.Fatalf("run %d: migrate: %v", run, err)
		}
		if n := wildcardRules(t, db, "song"); n != 0 {
			t.Fatalf("run %d: the ungranted restricted command kept %d wildcard rule(s)", run, n)
		}
		if v := visibility(t, db, moduleCommandID); v != "public" {
			t.Fatalf("run %d: the ungranted module command is %q, want public", run, v)
		}
		if n := count(t, db, `SELECT COUNT(*) FROM permissions`); n != 4 {
			t.Fatalf("run %d: %d rule(s) left, want the four granted or public ones", run, n)
		}
	}
}
