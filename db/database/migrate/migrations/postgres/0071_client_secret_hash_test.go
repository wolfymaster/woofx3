package postgres

import (
	"strings"
	"testing"

	"github.com/go-gormigrate/gormigrate/v2"
)

// aHash is 64 lowercase hex digits, the shape of a stored secret hash.
var aHash = strings.Repeat("ab", 32)

func TestClientSecretHashConstraints(t *testing.T) {
	db := openEmptyPostgres(t)
	if err := gormigrate.New(db, gormigrate.DefaultOptions, All()).MigrateTo("0070_client_kind_origin"); err != nil {
		t.Fatalf("migrate to 0070: %v", err)
	}
	mustExec(t, db, `INSERT INTO public.clients (description, client_id, client_secret)
		VALUES ('desktop', '00000000-0000-0000-0000-0000000000c1', 'plain')`)
	if err := gormigrate.New(db, gormigrate.DefaultOptions, All()).MigrateTo("0071_client_secret_hash"); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if err := AddClientSecretHash().Migrate(db); err != nil {
		t.Fatalf("second run: %v", err)
	}
	if n := count(t, db, `SELECT COUNT(*) FROM public.clients WHERE client_secret = 'plain'`); n != 1 {
		t.Errorf("existing clients with their plain text = %d, want 1", n)
	}

	insert := `INSERT INTO public.clients (description, client_id, client_secret, client_secret_hash) VALUES ('x', ?, ?, ?)`
	mustExec(t, db, insert, "00000000-0000-0000-0000-0000000000c2", nil, aHash)
	mustExec(t, db, insert, "00000000-0000-0000-0000-0000000000c3", "plain", nil)

	refused := []struct {
		name string
		args []any
	}{
		{"a client with no secret at all", []any{"00000000-0000-0000-0000-0000000000c4", nil, nil}},
		{"a hash that is too short", []any{"00000000-0000-0000-0000-0000000000c5", nil, "abcd"}},
		{"a hash in upper case", []any{"00000000-0000-0000-0000-0000000000c6", nil, strings.ToUpper(aHash)}},
	}
	for _, tc := range refused {
		if err := db.Exec(insert, tc.args...).Error; err == nil {
			t.Errorf("%s was accepted", tc.name)
		}
	}
}
