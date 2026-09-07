package services

import (
	"context"
	"errors"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"github.com/twitchtv/twirp"
	"github.com/wolfymaster/woofx3/db/database/models"
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
		`CREATE TABLE applications (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			user_id TEXT NOT NULL,
			is_default INTEGER NOT NULL DEFAULT 0
		)`,
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
			application_id TEXT NOT NULL,
			name VARCHAR(100) NOT NULL,
			description VARCHAR(500) DEFAULT '',
			is_built_in BOOLEAN NOT NULL DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			CONSTRAINT uq_group_application_name UNIQUE (application_id, name)
		)`,
		`CREATE TABLE user_groups (
			username VARCHAR(50) NOT NULL,
			group_id TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			PRIMARY KEY (username, group_id)
		)`,
		`CREATE TABLE commands (
			id TEXT PRIMARY KEY,
			application_id TEXT NOT NULL,
			command VARCHAR(255) NOT NULL,
			type VARCHAR(50) NOT NULL,
			type_value VARCHAR(500) DEFAULT '',
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

func TestResolveApplicationID_Passthrough(t *testing.T) {
	db := newTestDB(t)
	got, err := resolveApplicationID(context.Background(), db, "abc-123")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "abc-123" {
		t.Fatalf("expected passthrough, got %q", got)
	}
}

func TestResolveApplicationID_DefaultFound(t *testing.T) {
	db := newTestDB(t)
	app := &models.Application{ID: uuid.New(), Name: "default", IsDefault: true, UserID: uuid.New()}
	if err := db.Create(app).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}
	got, err := resolveApplicationID(context.Background(), db, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != app.ID.String() {
		t.Fatalf("expected default %s, got %q", app.ID, got)
	}
}

func TestResolveApplicationID_NoDefault(t *testing.T) {
	db := newTestDB(t)
	_, err := resolveApplicationID(context.Background(), db, "")
	var twerr twirp.Error
	if !errors.As(err, &twerr) {
		t.Fatalf("expected twirp error, got %v", err)
	}
	if twerr.Code() != twirp.NotFound {
		t.Fatalf("expected NotFound, got %s", twerr.Code())
	}
}
