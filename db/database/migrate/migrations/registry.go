// Package migrations names the migration chain for each database dialect and
// reports how much of it a database has applied.
//
// The chain is shared by the migrate tool, which applies it, and db-proxy,
// which reports it: a process can only know whether its database is current
// by comparing against the chain it was built with.
package migrations

import (
	"fmt"

	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/wolfymaster/woofx3/db/database"
	"github.com/wolfymaster/woofx3/db/database/migrate/migrations/postgres"
	"github.com/wolfymaster/woofx3/db/database/migrate/migrations/sqlite"
	"gorm.io/gorm"
)

// Options are the gormigrate options every runner uses. Status reads the
// table and column they name, so the two must never drift apart.
var Options = gormigrate.DefaultOptions

// For returns the dialect's migration chain, oldest first.
func For(dialect database.Dialect) ([]*gormigrate.Migration, error) {
	switch dialect {
	case database.DialectPostgres:
		return postgres.All(), nil
	case database.DialectSQLite:
		return sqlite.All(), nil
	default:
		return nil, fmt.Errorf("no migrations registered for dialect %q", dialect)
	}
}

// Status is how much of a migration chain a database has applied.
type Status struct {
	// Applied is the newest migration in the chain the database has
	// applied, or "" when it has applied none.
	Applied string
	// Latest is the newest migration in the chain.
	Latest string
	// Pending counts migrations in the chain the database has not applied.
	Pending int
}

// StatusOf compares a database against a migration chain. A database that
// has never been migrated has no migrations table; that is every migration
// pending, not an error.
func StatusOf(db *gorm.DB, chain []*gormigrate.Migration) (Status, error) {
	if len(chain) == 0 {
		return Status{}, fmt.Errorf("migration chain is empty")
	}

	applied := make(map[string]bool)
	if db.Migrator().HasTable(Options.TableName) {
		var ids []string
		query := fmt.Sprintf("SELECT %s FROM %s", Options.IDColumnName, Options.TableName)
		if err := db.Raw(query).Scan(&ids).Error; err != nil {
			return Status{}, fmt.Errorf("read applied migrations: %w", err)
		}
		for _, id := range ids {
			applied[id] = true
		}
	}

	status := Status{Latest: chain[len(chain)-1].ID}
	for _, migration := range chain {
		if applied[migration.ID] {
			status.Applied = migration.ID
		} else {
			status.Pending++
		}
	}
	return status, nil
}
