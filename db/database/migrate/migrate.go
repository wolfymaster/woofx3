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
		migrations.CreateWorkerEventsTable(),
		migrations.CreateWorkflowTables(),
		migrations.CreateModuleTables(),
		migrations.CreateModuleTriggerTable(),
		migrations.AddClientCallbackUrl(),
		migrations.AddResourceOriginColumns(),
		migrations.CreateModuleResourcesTable(),
		migrations.CreateModuleActionsTable(),
		migrations.RelaxWorkerEventUuidColumns(),
		migrations.DecoupleTriggerActionsFromModules(),
		migrations.AddModuleKeyColumn(),
		migrations.CreateResourceReferencesTable(),
		migrations.AddApplicationsIsDefault(),
		migrations.AddUsersWoofx3UIUserID(),
		migrations.AddUsersDeletedAt(),
	})

	return m.Migrate()
}

// Rollback rolls back the last migration
func Rollback(db *gorm.DB) error {
	m := gormigrate.New(db, gormigrate.DefaultOptions, []*gormigrate.Migration{
		migrations.CreateInitialSchema(),
	})

	return m.RollbackLast()
}
