package database

import (
	"fmt"
	"net/url"
	"strings"
)

// Dialect is the system-DB backend selected from the connection URL scheme.
type Dialect string

const (
	DialectPostgres Dialect = "postgres"
	DialectSQLite   Dialect = "sqlite"
)

// ParsedDSN is a connection URL broken into the dialector GORM should use and
// a driver-ready DSN (path for SQLite, original URL for Postgres/pgx).
type ParsedDSN struct {
	Dialect Dialect
	// DriverDSN is what the selected GORM dialector expects.
	DriverDSN string
	// Original is the untouched config / env value (for logs).
	Original string
}

// ParseDatabaseURL chooses postgres vs sqlite from the URL scheme.
//
// Supported forms:
//   - postgresql://… / postgres://…  → DialectPostgres (DSN unchanged for pgx)
//   - sqlite://relative.db           → DialectSQLite, path "relative.db"
//   - sqlite:///absolute/path.db     → DialectSQLite, path "/absolute/path.db"
//   - sqlite:///:memory:             → DialectSQLite, path ":memory:"
//   - :memory:                       → DialectSQLite (bare, no scheme)
func ParseDatabaseURL(raw string) (ParsedDSN, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ParsedDSN{}, fmt.Errorf("database URL is empty")
	}
	if raw == ":memory:" {
		return ParsedDSN{Dialect: DialectSQLite, DriverDSN: ":memory:", Original: raw}, nil
	}

	u, err := url.Parse(raw)
	if err != nil {
		return ParsedDSN{}, fmt.Errorf("parse database URL: %w", err)
	}

	scheme := strings.ToLower(u.Scheme)
	switch scheme {
	case "postgres", "postgresql":
		return ParsedDSN{Dialect: DialectPostgres, DriverDSN: raw, Original: raw}, nil
	case "sqlite":
		path, pathErr := sqlitePathFromURL(u)
		if pathErr != nil {
			return ParsedDSN{}, pathErr
		}
		return ParsedDSN{Dialect: DialectSQLite, DriverDSN: path, Original: raw}, nil
	case "":
		return ParsedDSN{}, fmt.Errorf(
			"database URL %q has no scheme; use postgresql://… or sqlite://…",
			raw,
		)
	default:
		return ParsedDSN{}, fmt.Errorf(
			"unsupported database URL scheme %q (supported: postgresql, postgres, sqlite)",
			scheme,
		)
	}
}

// sqlitePathFromURL maps sqlite:// URLs onto a filesystem path or ":memory:".
//
// url.Parse quirks we normalize:
//
//	sqlite://db.sqlite          → Host=db.sqlite, Path=""
//	sqlite:///tmp/db.sqlite     → Host="", Path=/tmp/db.sqlite
//	sqlite://./data/db.sqlite   → Host=., Path=/data/db.sqlite
//	sqlite:///:memory:          → Host="", Path=/:memory:
func sqlitePathFromURL(u *url.URL) (string, error) {
	path := u.Opaque
	if path == "" {
		if u.Host != "" && u.Path != "" {
			path = u.Host + u.Path
		} else if u.Host != "" {
			path = u.Host
		} else {
			path = u.Path
		}
	}

	path = strings.TrimSpace(path)
	if path == "" {
		return "", fmt.Errorf("sqlite URL has empty path")
	}

	// sqlite:///:memory: → "/:memory:"
	if path == "/:memory:" || path == ":memory:" {
		return ":memory:", nil
	}

	return path, nil
}
