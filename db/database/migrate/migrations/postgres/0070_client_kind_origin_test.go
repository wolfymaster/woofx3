package postgres

import (
	"testing"

	"github.com/go-gormigrate/gormigrate/v2"
)

func TestClientKindOriginKeepsExistingClientsRegistered(t *testing.T) {
	db := openEmptyPostgres(t)
	if err := gormigrate.New(db, gormigrate.DefaultOptions, All()).MigrateTo("0068_local_ui_settings"); err != nil {
		t.Fatalf("migrate to 0068: %v", err)
	}
	mustExec(t, db, `INSERT INTO public.clients (description, client_id, client_secret)
		VALUES ('desktop', '00000000-0000-0000-0000-0000000000c1', 's1')`)

	if err := gormigrate.New(db, gormigrate.DefaultOptions, All()).MigrateTo("0070_client_kind_origin"); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	if n := count(t, db, `SELECT COUNT(*) FROM public.clients
		WHERE kind = 'registered' AND origin IS NULL AND created_at IS NOT NULL AND last_authenticated_at IS NULL`); n != 1 {
		t.Errorf("migrated registered clients = %d, want 1", n)
	}
}

func TestClientKindOriginConstraints(t *testing.T) {
	db := openEmptyPostgres(t)
	if err := gormigrate.New(db, gormigrate.DefaultOptions, All()).MigrateTo("0070_client_kind_origin"); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	insert := `INSERT INTO public.clients (description, client_id, client_secret, kind, origin) VALUES ('x', ?, 's', ?, ?)`

	mustExec(t, db, insert, "00000000-0000-0000-0000-0000000000c1", "registered", nil)
	mustExec(t, db, insert, "00000000-0000-0000-0000-0000000000c2", "paired", "http://localhost:5173")

	refused := []struct {
		name string
		args []any
	}{
		{"an unknown kind", []any{"00000000-0000-0000-0000-0000000000c3", "browser", nil}},
		{"a paired client without an origin", []any{"00000000-0000-0000-0000-0000000000c4", "paired", nil}},
		{"a registered client with an origin", []any{"00000000-0000-0000-0000-0000000000c5", "registered", "http://localhost:5173"}},
	}
	for _, tc := range refused {
		if err := db.Exec(insert, tc.args...).Error; err == nil {
			t.Errorf("%s was accepted", tc.name)
		}
	}
}

func TestClientKindOriginRunsTwiceAndRollsBack(t *testing.T) {
	db := openEmptyPostgres(t)
	if err := gormigrate.New(db, gormigrate.DefaultOptions, All()).MigrateTo("0070_client_kind_origin"); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if err := AddClientKindOrigin().Migrate(db); err != nil {
		t.Fatalf("second run: %v", err)
	}
	if err := gormigrate.New(db, gormigrate.DefaultOptions, All()).RollbackTo("0068_local_ui_settings"); err != nil {
		t.Fatalf("rollback: %v", err)
	}
	if n := count(t, db, `SELECT COUNT(*) FROM information_schema.columns
		WHERE table_name = 'clients' AND column_name IN ('kind', 'origin', 'created_at', 'last_authenticated_at')`); n != 0 {
		t.Errorf("%d new columns survived the rollback", n)
	}
}
