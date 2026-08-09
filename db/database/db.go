package database

import (
	"log/slog"
	"time"

	"github.com/dgraph-io/badger/v3"
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

	db, err := gorm.Open(postgres.New(postgres.Config{
		DSN: dsn,
		// The configured DSN may point at a PgBouncer-style transaction pooler
		// (e.g. Neon's "-pooler" endpoint), which routes each statement to a
		// possibly different backend connection. The extended query protocol's
		// named server-side prepared statements don't survive that, causing
		// "prepared statement ... already in use" errors under concurrent load.
		// Simple protocol avoids server-side prepare entirely.
		PreferSimpleProtocol: true,
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

	// Set connection pool settings
	sqlDB.SetMaxIdleConns(10)
	sqlDB.SetMaxOpenConns(100)
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
