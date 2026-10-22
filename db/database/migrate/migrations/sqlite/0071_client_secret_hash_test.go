package sqlite

import (
	"strings"
	"testing"

	"github.com/go-gormigrate/gormigrate/v2"
)

// aHash is 64 lowercase hex digits, the shape of a stored secret hash.
var aHash = strings.Repeat("ab", 32)

func TestClientSecretHashKeepsExistingClientsAndTheirSequence(t *testing.T) {
	db := openMigratedTo(t, "0070_client_kind_origin")
	mustExec(t, db, `INSERT INTO clients (description, client_id, client_secret, created_at)
		VALUES ('desktop', 'c1', 'plain', datetime('now'))`)
	mustExec(t, db, `INSERT INTO clients (description, client_id, client_secret, created_at)
		VALUES ('gone', 'c2', 'plain', datetime('now'))`)
	mustExec(t, db, `DELETE FROM clients WHERE client_id = 'c2'`)

	if err := gormigrate.New(db, gormigrate.DefaultOptions, All()).MigrateTo("0071_client_secret_hash"); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	if n := count(t, db, `SELECT COUNT(*) FROM clients WHERE client_id = 'c1' AND client_secret = 'plain'`); n != 1 {
		t.Errorf("existing clients with their plain text = %d, want 1", n)
	}
	if n := count(t, db, `SELECT seq FROM sqlite_sequence WHERE name = 'clients'`); n != 2 {
		t.Errorf("clients sequence = %d, want 2: a deleted client's id would be handed out again", n)
	}
	if n := count(t, db, `SELECT "notnull" FROM pragma_table_info('clients') WHERE name = 'client_secret'`); n != 0 {
		t.Error("client_secret is still NOT NULL")
	}
}

func TestClientSecretHashConstraints(t *testing.T) {
	db := openMigratedTo(t, "0071_client_secret_hash")
	insert := `INSERT INTO clients (description, client_id, client_secret, client_secret_hash, kind, origin, created_at)
		VALUES ('x', ?, ?, ?, ?, ?, datetime('now'))`

	mustExec(t, db, insert, "hash-only", nil, aHash, "registered", nil)
	mustExec(t, db, insert, "previous-release", "plain", nil, "registered", nil)

	refused := []struct {
		name string
		args []any
	}{
		{"a client with no secret at all", []any{"none", nil, nil, "registered", nil}},
		{"a hash that is too short", []any{"short", nil, "abcd", "registered", nil}},
		{"a hash in upper case", []any{"upper", nil, strings.ToUpper(aHash), "registered", nil}},
		{"a paired client without an origin, after the rebuild", []any{"paired", nil, aHash, "paired", nil}},
	}
	for _, tc := range refused {
		if err := db.Exec(insert, tc.args...).Error; err == nil {
			t.Errorf("%s was accepted", tc.name)
		}
	}
}

func TestClientSecretHashRunsTwice(t *testing.T) {
	db := openMigratedTo(t, "0071_client_secret_hash")
	mustExec(t, db, `INSERT INTO clients (description, client_id, client_secret_hash, created_at)
		VALUES ('x', 'c1', ?, datetime('now'))`, aHash)

	if err := AddClientSecretHash().Migrate(db); err != nil {
		t.Fatalf("second run: %v", err)
	}

	if n := count(t, db, `SELECT COUNT(*) FROM clients WHERE client_secret_hash = ?`, aHash); n != 1 {
		t.Errorf("clients after a second run = %d, want 1", n)
	}
}
