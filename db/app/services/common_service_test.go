package services

import (
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

// newTestDB creates an in-memory SQLite database with SQLite-compatible
// schemas for tables that tests touch. The production gorm tags rely on
// Postgres-only uuid_generate_v4(), which SQLite cannot parse, so
// AutoMigrate is not used here.
func newTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	stmts := []string{
		`CREATE TABLE users (
			id TEXT PRIMARY KEY,
			username TEXT,
			user_id TEXT,
			platform TEXT,
			woofx3_ui_user_id TEXT,
			deleted_at DATETIME,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE groups (
			id TEXT PRIMARY KEY,
			name VARCHAR(100) NOT NULL UNIQUE,
			description VARCHAR(500) DEFAULT '',
			is_built_in BOOLEAN NOT NULL DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE user_groups (
			username VARCHAR(50) NOT NULL,
			group_id TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (username, group_id)
		)`,
		`CREATE TABLE commands (
			id TEXT PRIMARY KEY,
			command VARCHAR(255) NOT NULL,
			actions TEXT NOT NULL DEFAULT '[]',
			cooldown INTEGER DEFAULT 0,
			priority INTEGER DEFAULT 0,
			enabled BOOLEAN DEFAULT 1,
			created_by_type TEXT NOT NULL DEFAULT 'USER',
			created_by_ref TEXT NOT NULL DEFAULT '',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			visibility VARCHAR(20) NOT NULL DEFAULT 'restricted',
			argument_pattern VARCHAR(255) NOT NULL DEFAULT ''
		)`,
		`CREATE TABLE command_groups (
			command_id TEXT NOT NULL,
			group_id TEXT NOT NULL,
			PRIMARY KEY (command_id, group_id)
		)`,
		`CREATE TABLE command_users (
			command_id TEXT NOT NULL,
			username VARCHAR(50) NOT NULL,
			PRIMARY KEY (command_id, username)
		)`,
	}
	for _, s := range stmts {
		if err := db.Exec(s).Error; err != nil {
			t.Fatalf("exec ddl: %v", err)
		}
	}
	return db
}
