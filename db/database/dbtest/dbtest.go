// Package dbtest opens fully migrated system databases for tests, one per
// dialect the engine ships with.
//
// SQLite is the default for packaged engines and Postgres for hosted ones,
// and the two accept different SQL. A test that runs a query through
// ForEachDialect proves it on both: SQLite always, Postgres when
// PostgresURLEnv names a database (CI's postgres job sets it).
package dbtest

import (
	"log/slog"
	"os"
	"testing"

	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/wolfymaster/woofx3/db/database"
	"github.com/wolfymaster/woofx3/db/database/migrate/migrations"
	"gorm.io/gorm"
)

// PostgresURLEnv names an empty, throwaway Postgres database. Every test
// that uses it drops the public schema when it ends, so it must never point
// at one holding data.
const PostgresURLEnv = "WOOFX3_MIGRATION_TEST_POSTGRES_URL"

// ForEachDialect runs `test` as a "sqlite" subtest against a fully migrated
// in-memory SQLite database and as a "postgres" subtest against a fully
// migrated Postgres one, which skips when PostgresURLEnv is not set.
func ForEachDialect(t *testing.T, test func(t *testing.T, db *gorm.DB)) {
	t.Helper()
	t.Run("sqlite", func(t *testing.T) {
		test(t, OpenSQLite(t))
	})
	t.Run("postgres", func(t *testing.T) {
		test(t, OpenPostgres(t))
	})
}

// OpenSQLite returns an in-memory SQLite database with the whole SQLite
// migration chain applied.
func OpenSQLite(t *testing.T) *gorm.DB {
	t.Helper()
	db := open(t, "sqlite:///:memory:")
	migrate(t, db, database.DialectSQLite)
	return db
}

// OpenPostgres returns the database PostgresURLEnv names with the whole
// Postgres migration chain applied, and empties it again when the test ends.
// It skips the test when PostgresURLEnv is not set, and fails it when the
// database already holds tables.
func OpenPostgres(t *testing.T) *gorm.DB {
	t.Helper()
	url := os.Getenv(PostgresURLEnv)
	if url == "" {
		t.Skipf("%s not set", PostgresURLEnv)
	}
	db := open(t, url)
	var tables int64
	if err := db.Raw(`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'`).
		Scan(&tables).Error; err != nil {
		t.Fatalf("count tables: %v", err)
	}
	if tables > 0 {
		t.Fatalf("%s points at a database with %d tables; use an empty, throwaway one", PostgresURLEnv, tables)
	}
	t.Cleanup(func() {
		if err := db.Exec(`DROP SCHEMA public CASCADE`).Error; err != nil {
			t.Errorf("drop schema: %v", err)
		}
		if err := db.Exec(`CREATE SCHEMA public`).Error; err != nil {
			t.Errorf("create schema: %v", err)
		}
		// Each test opens its own pool; leaving it open runs a full
		// package run past the server's connection limit.
		sqlDB, err := db.DB()
		if err != nil {
			t.Errorf("sql db: %v", err)
			return
		}
		if err := sqlDB.Close(); err != nil {
			t.Errorf("close postgres: %v", err)
		}
	})
	migrate(t, db, database.DialectPostgres)
	return db
}

// open connects the way db-proxy does, so tests run with its connection
// settings and its id assignment on creates.
func open(t *testing.T, url string) *gorm.DB {
	t.Helper()
	db, err := database.InitializeDB(url, slog.New(slog.DiscardHandler), database.RandomIDs{})
	if err != nil {
		t.Fatalf("open %s database: %v", url, err)
	}
	return db
}

func migrate(t *testing.T, db *gorm.DB, dialect database.Dialect) {
	t.Helper()
	chain, err := migrations.For(dialect)
	if err != nil {
		t.Fatalf("migrations.For: %v", err)
	}
	if err := gormigrate.New(db, migrations.Options, chain).Migrate(); err != nil {
		t.Fatalf("migrate %s: %v", dialect, err)
	}
}
