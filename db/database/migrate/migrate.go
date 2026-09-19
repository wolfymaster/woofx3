package main

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/wolfymaster/woofx3/db/database"
	"github.com/wolfymaster/woofx3/db/database/migrate/migrations"
	"gorm.io/gorm"
)

// Migrate runs all migrations for the dialect of the open connection.
func Migrate(db *gorm.DB, dialect database.Dialect) error {
	chain, err := migrations.For(dialect)
	if err != nil {
		return err
	}
	return gormigrate.New(db, migrations.Options, chain).Migrate()
}

// Rollback rolls back the last migration for the dialect of the open connection.
func Rollback(db *gorm.DB, dialect database.Dialect) error {
	chain, err := migrations.For(dialect)
	if err != nil {
		return err
	}
	return gormigrate.New(db, migrations.Options, chain).RollbackLast()
}
