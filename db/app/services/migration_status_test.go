package services

import (
	"context"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/go-gormigrate/gormigrate/v2"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/database"
	"github.com/wolfymaster/woofx3/db/database/migrate/migrations"
	"gorm.io/gorm"
)

func openEmptySQLite(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	return db
}

func sqliteChain(t *testing.T) []*gormigrate.Migration {
	t.Helper()
	chain, err := migrations.For(database.DialectSQLite)
	if err != nil {
		t.Fatalf("migrations.For: %v", err)
	}
	return chain
}

func TestMigrationStatusOnAnEmptyDatabaseReportsTheWholeChainPending(t *testing.T) {
	chain := sqliteChain(t)
	svc := NewCommonService(openEmptySQLite(t))

	resp, err := svc.MigrationStatus(context.Background(), &client.MigrationStatusRequest{})
	if err != nil {
		t.Fatalf("MigrationStatus: %v", err)
	}

	if resp.Applied != "" {
		t.Fatalf("applied = %q, want none", resp.Applied)
	}
	if resp.Latest != chain[len(chain)-1].ID {
		t.Fatalf("latest = %q, want %q", resp.Latest, chain[len(chain)-1].ID)
	}
	if int(resp.Pending) != len(chain) {
		t.Fatalf("pending = %d, want %d", resp.Pending, len(chain))
	}
}

func TestMigrationStatusAfterMigratingReportsNothingPending(t *testing.T) {
	db := openEmptySQLite(t)
	chain := sqliteChain(t)
	if err := gormigrate.New(db, migrations.Options, chain).Migrate(); err != nil {
		t.Fatalf("apply the sqlite chain: %v", err)
	}
	svc := NewCommonService(db)

	resp, err := svc.MigrationStatus(context.Background(), &client.MigrationStatusRequest{})
	if err != nil {
		t.Fatalf("MigrationStatus: %v", err)
	}

	if resp.Pending != 0 || resp.Applied != resp.Latest {
		t.Fatalf("status = applied %q latest %q pending %d, want fully migrated", resp.Applied, resp.Latest, resp.Pending)
	}
	if resp.Status.GetCode() != client.ResponseStatus_OK {
		t.Fatalf("status code = %v, want OK", resp.Status.GetCode())
	}
}
