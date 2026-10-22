package sqlite

import (
	"testing"

	"github.com/go-gormigrate/gormigrate/v2"
)

func TestClientKindOriginKeepsExistingClientsRegistered(t *testing.T) {
	db := openMigratedTo(t, "0068_local_ui_settings")
	mustExec(t, db, `INSERT INTO clients (description, client_id, client_secret) VALUES ('desktop', 'c1', 's1')`)

	if err := gormigrate.New(db, gormigrate.DefaultOptions, All()).MigrateTo("0070_client_kind_origin"); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	if n := count(t, db, `SELECT COUNT(*) FROM clients WHERE kind = 'registered' AND origin IS NULL`); n != 1 {
		t.Errorf("registered clients without an origin = %d, want 1", n)
	}
	if n := count(t, db, `SELECT COUNT(*) FROM clients WHERE created_at = ?`, clientCreatedAtUnknown); n != 0 {
		t.Errorf("%d clients kept the placeholder created_at", n)
	}
	if n := count(t, db, `SELECT COUNT(*) FROM clients WHERE last_authenticated_at IS NULL`); n != 1 {
		t.Errorf("clients never authenticated = %d, want 1", n)
	}
}

func TestClientKindOriginConstraints(t *testing.T) {
	db := openMigratedTo(t, "0070_client_kind_origin")
	insert := `INSERT INTO clients (description, client_id, client_secret, kind, origin, created_at)
		VALUES ('x', ?, 's', ?, ?, datetime('now'))`

	mustExec(t, db, insert, "registered", "registered", nil)
	mustExec(t, db, insert, "paired", "paired", "http://localhost:5173")

	refused := []struct {
		name string
		args []any
	}{
		{"an unknown kind", []any{"c1", "browser", nil}},
		{"a paired client without an origin", []any{"c2", "paired", nil}},
		{"a registered client with an origin", []any{"c3", "registered", "http://localhost:5173"}},
	}
	for _, tc := range refused {
		if err := db.Exec(insert, tc.args...).Error; err == nil {
			t.Errorf("%s was accepted", tc.name)
		}
	}
}

func TestClientKindOriginRollsBack(t *testing.T) {
	db := openMigratedTo(t, "0070_client_kind_origin")
	if err := gormigrate.New(db, gormigrate.DefaultOptions, All()).RollbackTo("0068_local_ui_settings"); err != nil {
		t.Fatalf("rollback: %v", err)
	}
	for _, column := range []string{"kind", "origin", "created_at", "last_authenticated_at"} {
		exists, err := columnExists(db, "clients", column)
		if err != nil {
			t.Fatalf("columnExists(%s): %v", column, err)
		}
		if exists {
			t.Errorf("clients.%s survived the rollback", column)
		}
	}
}
