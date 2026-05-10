package main

import (
	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/wolfymaster/woofx3/db/database/migrate/migrations"
	"gorm.io/gorm"
)

// Migrate runs all database migrations
func Migrate(db *gorm.DB) error {
	m := gormigrate.New(db, gormigrate.DefaultOptions, []*gormigrate.Migration{
		migrations.CreateInitialSchema(),
		migrations.AddCanonicalIDColumns(),
		migrations.AddActionTypeColumn(),
		migrations.AddWorkflowManifestIDColumn(),
		migrations.AddWorkflowEnabledColumn(),
		migrations.CreateScenesTable(),
		migrations.CreateAssetsTable(),
		migrations.CreateAlertsTable(),
		migrations.CreateModuleResourceInstancesTable(),
		migrations.AddAlertLifecycle(),
		migrations.CreateWidgetStatusTable(),
	})

	return m.Migrate()
}

// Rollback rolls back the last migration
func Rollback(db *gorm.DB) error {
	m := gormigrate.New(db, gormigrate.DefaultOptions, []*gormigrate.Migration{
		migrations.CreateInitialSchema(),
		migrations.AddCanonicalIDColumns(),
		migrations.AddActionTypeColumn(),
		migrations.AddWorkflowManifestIDColumn(),
		migrations.AddWorkflowEnabledColumn(),
		migrations.CreateScenesTable(),
		migrations.CreateAssetsTable(),
		migrations.CreateAlertsTable(),
		migrations.CreateModuleResourceInstancesTable(),
		migrations.AddAlertLifecycle(),
		migrations.CreateWidgetStatusTable(),
	})

	return m.RollbackLast()
}
