package migrations

import (
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/wolfymaster/woofx3/db/database"
	"gorm.io/gorm"
)

func openMemory(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	return db
}

// chain is a stand-in migration chain whose steps create nothing.
func chain(ids ...string) []*gormigrate.Migration {
	out := make([]*gormigrate.Migration, 0, len(ids))
	for _, id := range ids {
		out = append(out, &gormigrate.Migration{
			ID:      id,
			Migrate: func(*gorm.DB) error { return nil },
		})
	}
	return out
}

func apply(t *testing.T, db *gorm.DB, migrations []*gormigrate.Migration) {
	t.Helper()
	if err := gormigrate.New(db, gormigrate.DefaultOptions, migrations).Migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
}

func TestAnUnmigratedDatabaseHasEverythingPending(t *testing.T) {
	status, err := StatusOf(openMemory(t), chain("0001_a", "0002_b", "0003_c"))
	if err != nil {
		t.Fatalf("StatusOf: %v", err)
	}

	want := Status{Applied: "", Latest: "0003_c", Pending: 3}
	if status != want {
		t.Fatalf("status = %+v, want %+v", status, want)
	}
}

func TestAPartlyMigratedDatabaseReportsWhereItStopped(t *testing.T) {
	db := openMemory(t)
	apply(t, db, chain("0001_a", "0002_b"))

	status, err := StatusOf(db, chain("0001_a", "0002_b", "0003_c"))
	if err != nil {
		t.Fatalf("StatusOf: %v", err)
	}

	want := Status{Applied: "0002_b", Latest: "0003_c", Pending: 1}
	if status != want {
		t.Fatalf("status = %+v, want %+v", status, want)
	}
}

func TestAFullyMigratedDatabaseHasNothingPending(t *testing.T) {
	db := openMemory(t)
	full := chain("0001_a", "0002_b", "0003_c")
	apply(t, db, full)

	status, err := StatusOf(db, full)
	if err != nil {
		t.Fatalf("StatusOf: %v", err)
	}

	want := Status{Applied: "0003_c", Latest: "0003_c", Pending: 0}
	if status != want {
		t.Fatalf("status = %+v, want %+v", status, want)
	}
}

func TestEveryDialectHasAChain(t *testing.T) {
	for _, dialect := range []database.Dialect{database.DialectPostgres, database.DialectSQLite} {
		chain, err := For(dialect)
		if err != nil {
			t.Fatalf("For(%s): %v", dialect, err)
		}
		if len(chain) == 0 {
			t.Fatalf("For(%s) returned no migrations", dialect)
		}
	}
	if _, err := For("mysql"); err == nil {
		t.Fatal("For(mysql) must fail: no chain is registered for it")
	}
}
