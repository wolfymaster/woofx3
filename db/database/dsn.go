package database

import (
	"fmt"
	"net/url"
	"strings"

	"github.com/wolfymaster/woofx3/common/runtime"
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
//   - sqlite:///C:/data/path.db      → DialectSQLite, path "C:/data/path.db"
//   - sqlite:///:memory:             → DialectSQLite, path ":memory:"
//   - :memory:                       → DialectSQLite (bare, no scheme)
//
// A relative SQLite path is anchored in WOOFX3_DATA_DIR when that is set (see
// runtime.ResolveDataPath). This is the one place both the db proxy and the
// migrate tool turn the URL into a file, so they always open the same one.
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

	// sqlite:///C:/data/x.db → "/C:/data/x.db", which no OS reads as a drive.
	if len(path) > 1 && path[0] == '/' && hasDriveLetter(path[1:]) {
		path = path[1:]
	}
	if isRootedOnAnyOS(path) {
		return path, nil
	}
	return runtime.ResolveDataPath(path), nil
}

// hasDriveLetter reports whether path starts with a Windows drive, "C:/" or
// "C:\".
func hasDriveLetter(path string) bool {
	if len(path) < 3 || path[1] != ':' || (path[2] != '/' && path[2] != '\\') {
		return false
	}
	letter := path[0] | 0x20
	return letter >= 'a' && letter <= 'z'
}

// isRootedOnAnyOS reports whether path names a location independent of the
// working directory on some OS: a drive path, or one starting at a root. Such
// a path is never anchored in the data directory, whichever OS the URL was
// written for. filepath.IsAbs alone would anchor "/var/db.sqlite" on Windows,
// where it has no drive, and "C:/data/x.db" everywhere else.
func isRootedOnAnyOS(path string) bool {
	return hasDriveLetter(path) || strings.HasPrefix(path, "/") || strings.HasPrefix(path, "\\")
}
