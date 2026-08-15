package database

import (
	"log/slog"
	"time"

	"github.com/dgraph-io/badger/v3"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"gorm.io/gorm/schema"
)

// InitializeDB initializes the database with the given DSN and logger
func InitializeDB(dsn string, slogger *slog.Logger) (*gorm.DB, error) {
	// slog logger
	slogAdapter := NewSlogAdapter(slogger, logger.Config{
		SlowThreshold:             200 * time.Millisecond,
		LogLevel:                  logger.Info,
		IgnoreRecordNotFoundError: true,
		Colorful:                  false,
	})

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
	}), &gorm.Config{
		Logger: slogAdapter,
		NamingStrategy: schema.NamingStrategy{
			SingularTable: true,
		},
	})

	if err != nil {
		return nil, err
	}

	// Get underlying SQL DB to set connection pool parameters
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

	// Enable UUID extension if it's not already enabled
	db.Exec("CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\"")

	// TODO: Enable
	// db.AutoMigrate(&User{}, &Setting{}, &UserEvent{}, &UserMessage{})

	return db, nil
}

func InitializeBadgerDB(path string) (*badger.DB, error) {
	opts := badger.DefaultOptions(path).WithSyncWrites(true)
	return badger.Open(opts)
}
