package database

import (
	"io"
	"log/slog"
	"testing"
)

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestParseDatabaseURL_Postgres(t *testing.T) {
	cases := []string{
		"postgresql://user:pass@localhost:5432/woofx3?sslmode=require",
		"postgres://localhost/woofx3",
	}
	for _, raw := range cases {
		got, err := ParseDatabaseURL(raw)
		if err != nil {
			t.Fatalf("%q: %v", raw, err)
		}
		if got.Dialect != DialectPostgres {
			t.Fatalf("%q: dialect = %q, want postgres", raw, got.Dialect)
		}
		if got.DriverDSN != raw {
			t.Fatalf("%q: DriverDSN mutated", raw)
		}
	}
}

func TestParseDatabaseURL_SQLite(t *testing.T) {
	cases := []struct {
		raw  string
		path string
	}{
		{":memory:", ":memory:"},
		{"sqlite:///:memory:", ":memory:"},
		{"sqlite://db.sqlite", "db.sqlite"},
		{"sqlite:///tmp/woofx3.db", "/tmp/woofx3.db"},
		{"sqlite://./data/db.sqlite", "./data/db.sqlite"},
	}
	for _, tc := range cases {
		got, err := ParseDatabaseURL(tc.raw)
		if err != nil {
			t.Fatalf("%q: %v", tc.raw, err)
		}
		if got.Dialect != DialectSQLite {
			t.Fatalf("%q: dialect = %q, want sqlite", tc.raw, got.Dialect)
		}
		if got.DriverDSN != tc.path {
			t.Fatalf("%q: path = %q, want %q", tc.raw, got.DriverDSN, tc.path)
		}
	}
}

func TestParseDatabaseURL_Rejects(t *testing.T) {
	cases := []string{"", "mysql://localhost/db", "db.sqlite"}
	for _, raw := range cases {
		if _, err := ParseDatabaseURL(raw); err == nil {
			t.Fatalf("%q: expected error", raw)
		}
	}
}

func TestInitializeDB_SQLiteMemory(t *testing.T) {
	db, err := InitializeDB("sqlite:///:memory:", discardLogger())
	if err != nil {
		t.Fatalf("InitializeDB: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("db.DB: %v", err)
	}
	if err := sqlDB.Ping(); err != nil {
		t.Fatalf("ping: %v", err)
	}
	_ = sqlDB.Close()
}
