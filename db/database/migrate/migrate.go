package main

import (
	"fmt"

	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/wolfymaster/woofx3/db/database"
	"github.com/wolfymaster/woofx3/db/database/migrate/migrations/postgres"
	"github.com/wolfymaster/woofx3/db/database/migrate/migrations/sqlite"
	"gorm.io/gorm"
)

// MigrationsFor returns the dialect-specific migration chain.
func MigrationsFor(dialect database.Dialect) ([]*gormigrate.Migration, error) {
	switch dialect {
	case database.DialectPostgres:
		return postgres.All(), nil
	case database.DialectSQLite:
		return sqlite.All(), nil
	default:
		return nil, fmt.Errorf("no migrations registered for dialect %q", dialect)
	}
}

// Migrate runs all migrations for the dialect of the open connection.
func Migrate(db *gorm.DB, dialect database.Dialect) error {
	migrations, err := MigrationsFor(dialect)
	if err != nil {
		return err
	}
	return gormigrate.New(db, gormigrate.DefaultOptions, migrations).Migrate()
}

// Rollback rolls back the last migration for the dialect of the open connection.
func Rollback(db *gorm.DB, dialect database.Dialect) error {
	migrations, err := MigrationsFor(dialect)
	if err != nil {
		return err
	}
	return gormigrate.New(db, gormigrate.DefaultOptions, migrations).RollbackLast()
}
