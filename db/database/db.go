package database

import (
	"fmt"
	"log/slog"
	"time"

	"github.com/dgraph-io/badger/v3"
	"github.com/glebarez/sqlite"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"gorm.io/gorm/schema"
)

// InitializeDB opens the system database using the dialector matching the URL
// scheme (postgresql:// / postgres:// → Postgres; sqlite:// → SQLite).
//
// Note: gormigrate SQL under database/migrate is still Postgres-dialect. SQLite
// is suitable for GORM usage and tests; running those migrations against
// SQLite will fail until dual-dialect migrations exist.
func InitializeDB(dsn string, slogger *slog.Logger) (*gorm.DB, error) {
	parsed, err := ParseDatabaseURL(dsn)
	if err != nil {
		return nil, err
	}

	slogAdapter := NewSlogAdapter(slogger, logger.Config{
		SlowThreshold:             200 * time.Millisecond,
		LogLevel:                  logger.Info,
		IgnoreRecordNotFoundError: true,
		Colorful:                  false,
	})

	gormCfg := &gorm.Config{
		Logger: slogAdapter,
		NamingStrategy: schema.NamingStrategy{
			SingularTable: true,
		},
	}

	switch parsed.Dialect {
	case DialectPostgres:
		return openPostgres(parsed.DriverDSN, gormCfg, slogger)
	case DialectSQLite:
		return openSQLite(parsed.DriverDSN, gormCfg, slogger)
	default:
		return nil, fmt.Errorf("unhandled database dialect %q", parsed.Dialect)
	}
}

func openPostgres(dsn string, gormCfg *gorm.Config, slogger *slog.Logger) (*gorm.DB, error) {
	slogger.Info("Opening system database", "dialect", DialectPostgres)

	// The configured DSN may point at a PgBouncer-style transaction pooler
	// (e.g. Neon's "-pooler" endpoint), which routes each statement to a
	// possibly different backend connection. pgx's default exec mode names
	// and caches prepared statements server-side, which don't survive that
	// hand-off and cause "prepared statement ... already in use" errors
	// under concurrent load. CacheDescribe avoids named statements (every
	// prepare is anonymous) while still caching the parameter/result type
	// info client-side, so repeat queries stay a single round trip. This
	// service runs one instance per engine — hundreds of them share this
	// one Postgres instance through the pooler, so the pooler itself isn't
	// optional here; only the exec mode needed to change.
	pgxConfig, err := pgx.ParseConfig(dsn)
	if err != nil {
		return nil, err
	}
	pgxConfig.DefaultQueryExecMode = pgx.QueryExecModeCacheDescribe

	db, err := gorm.Open(postgres.New(postgres.Config{
		Conn: stdlib.OpenDB(*pgxConfig),
	}), gormCfg)
	if err != nil {
		return nil, err
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}

	// Kept small because this pool size is multiplied by every engine
	// instance's db-proxy hitting the same pooler; the pooler's own
	// client-connection ceiling, not this service, is the actual
	// constraint on the far side.
	sqlDB.SetMaxIdleConns(2)
	sqlDB.SetMaxOpenConns(10)
	sqlDB.SetConnMaxLifetime(time.Hour)

	if err := db.Exec(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`).Error; err != nil {
		return nil, fmt.Errorf("enable uuid-ossp extension: %w", err)
	}

	return db, nil
}

func openSQLite(path string, gormCfg *gorm.Config, slogger *slog.Logger) (*gorm.DB, error) {
	slogger.Info("Opening system database", "dialect", DialectSQLite, "path", path)

	db, err := gorm.Open(sqlite.Open(path), gormCfg)
	if err != nil {
		return nil, err
	}

	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}

	// SQLite is process-local; a single writer is the safe default.
	sqlDB.SetMaxOpenConns(1)
	sqlDB.SetMaxIdleConns(1)

	// Foreign keys are off by default in SQLite; match Postgres expectations.
	if err := db.Exec("PRAGMA foreign_keys = ON").Error; err != nil {
		return nil, fmt.Errorf("enable sqlite foreign_keys: %w", err)
	}

	return db, nil
}

func InitializeBadgerDB(path string) (*badger.DB, error) {
	opts := badger.DefaultOptions(path).WithSyncWrites(true)
	return badger.Open(opts)
}
