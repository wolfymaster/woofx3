package migrate

import (
	"log"

	"github.com/go-gormigrate/gormigrate/v2"
	"gorm.io/gorm"
	"github.com/wolfymaster/woofx3-db/models"
)

// Migrate runs all database migrations
func Migrate(db *gorm.DB) error {
	m := gormigrate.New(db, gormigrate.DefaultOptions, []*gormigrate.Migration{
		createInitialSchema(),
		// Add future migrations here
	})

	return m.Migrate()
}

// Rollback rolls back the last migration
func Rollback(db *gorm.DB) error {
	m := gormigrate.New(db, gormigrate.DefaultOptions, []*gormigrate.Migration{
		createInitialSchema(),
	})

	return m.RollbackLast()
}

func createInitialSchema() *gormigrate.Migration {
	return &gormigrate.Migration{
		ID: "0001_initial_schema",
		Migrate: func(tx *gorm.DB) error {
			log.Println("Running initial schema migration...")
			return tx.AutoMigrate(
				// Base models without foreign keys first
				&models.User{},
				&models.Application{},
				
				// Models with foreign keys
				&models.Client{},
				&models.UserApplication{},
				&models.UserEvent{},
				&models.UserMeta{},
				&models.Setting{},
				&models.Command{},
				&models.WorkflowDefinition{},
				&models.WorkflowExecution{},
				&models.Treat{},
			)
		},
		Rollback: func(tx *gorm.DB) error {
			// Drop tables in reverse order to respect foreign key constraints
			tables := []string{
				"treats",
				"workflow_executions",
				"workflow_definitions",
				"commands",
				"settings",
				"user_meta",
				"user_events",
				"user_applications",
				"clients",
				"applications",
				"users",
			}

			for _, table := range tables {
				if err := tx.Migrator().DropTable(table); err != nil {
					return err
				}
			}
			return nil
		},
	}
}
