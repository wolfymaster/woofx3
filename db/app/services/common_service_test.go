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

// newTestDB creates an in-memory SQLite database with a SQLite-compatible
// applications schema — sufficient for resolveApplicationID tests. The
// production gorm tag relies on the Postgres-only uuid_generate_v4(),
// which SQLite cannot parse, so AutoMigrate is not used here.
func newTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	ddl := `CREATE TABLE applications (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		user_id TEXT NOT NULL,
		is_default INTEGER NOT NULL DEFAULT 0
	)`
	if err := db.Exec(ddl).Error; err != nil {
		t.Fatalf("create applications: %v", err)
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
