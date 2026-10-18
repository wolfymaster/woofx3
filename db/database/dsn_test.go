package database

import (
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/wolfymaster/woofx3/common/runtime"
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
	t.Setenv(runtime.DataDirEnv, "")
	cases := []struct {
		raw  string
		path string
	}{
		{":memory:", ":memory:"},
		{"sqlite:///:memory:", ":memory:"},
		{"sqlite://db.sqlite", "db.sqlite"},
		{"sqlite:///tmp/woofx3.db", "/tmp/woofx3.db"},
		{"sqlite://./data/db.sqlite", "./data/db.sqlite"},
		{"sqlite:///C:/data/woofx3.db", "C:/data/woofx3.db"},
		{"sqlite://C:/data/woofx3.db", "C:/data/woofx3.db"},
	}
	for _, tc := range cases {
		t.Run(tc.raw, func(t *testing.T) {
			got, err := ParseDatabaseURL(tc.raw)
			if err != nil {
				t.Fatalf("ParseDatabaseURL: %v", err)
			}
			if got.Dialect != DialectSQLite {
				t.Fatalf("dialect = %q, want sqlite", got.Dialect)
			}
			if got.DriverDSN != tc.path {
				t.Fatalf("path = %q, want %q", got.DriverDSN, tc.path)
			}
		})
	}
}

func TestParseDatabaseURL_SQLiteUnderDataDir(t *testing.T) {
	dataDir := t.TempDir()
	t.Setenv(runtime.DataDirEnv, dataDir)

	cases := []struct {
		raw  string
		path string
	}{
		{"sqlite://./data/woofx3.db", filepath.Join(dataDir, "data", "woofx3.db")},
		{"sqlite://db.sqlite", filepath.Join(dataDir, "db.sqlite")},
		{"sqlite:///tmp/woofx3.db", "/tmp/woofx3.db"},
		{"sqlite:///:memory:", ":memory:"},
		{":memory:", ":memory:"},
		// Windows paths are never anchored, whichever OS reads the URL.
		{"sqlite:///C:/data/woofx3.db", "C:/data/woofx3.db"},
		{"sqlite:///c:/data/woofx3.db", "c:/data/woofx3.db"},
		{"sqlite://C:/data/woofx3.db", "C:/data/woofx3.db"},
		{`sqlite:///D:\data\woofx3.db`, `D:\data\woofx3.db`},
	}
	for _, tc := range cases {
		t.Run(tc.raw, func(t *testing.T) {
			got, err := ParseDatabaseURL(tc.raw)
			if err != nil {
				t.Fatalf("ParseDatabaseURL: %v", err)
			}
			if got.DriverDSN != tc.path {
				t.Errorf("path = %q, want %q", got.DriverDSN, tc.path)
			}
		})
	}
}

func TestInitializeDB_SQLiteCreatesItsDirectoryUnderDataDir(t *testing.T) {
	dataDir := t.TempDir()
	t.Setenv(runtime.DataDirEnv, dataDir)

	db, err := InitializeDB("sqlite://./data/woofx3.db", discardLogger())
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

	if _, err := os.Stat(filepath.Join(dataDir, "data", "woofx3.db")); err != nil {
		t.Errorf("database file not created under the data dir: %v", err)
	}
}

func TestInitializeDB_SQLiteOutsideTheDataDirGetsNoDirectoryMade(t *testing.T) {
	t.Setenv(runtime.DataDirEnv, t.TempDir())
	missing := filepath.Join(t.TempDir(), "missing")

	// Opening may fail or not; only whether a directory was made matters.
	_, _ = InitializeDB("sqlite://"+filepath.Join(missing, "woofx3.db"), discardLogger())

	if _, err := os.Stat(missing); !os.IsNotExist(err) {
		t.Errorf("directory outside the data dir was created (stat err = %v)", err)
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
