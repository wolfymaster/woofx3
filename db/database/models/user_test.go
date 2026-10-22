package models_test

import (
	"context"
	"testing"

	"github.com/wolfymaster/woofx3/db/database/dbtest"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
)

func TestFindOrCreateUserCreatesOnceOnEveryDialect(t *testing.T) {
	dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
		created, err := models.FindOrCreateUser(context.Background(), db, "twitch-42")
		if err != nil {
			t.Fatalf("create: %v", err)
		}
		if created.ID == "" {
			t.Fatal("created user has no id")
		}
		found, err := models.FindOrCreateUser(context.Background(), db, "twitch-42")
		if err != nil {
			t.Fatalf("find: %v", err)
		}
		if found.ID != created.ID {
			t.Fatalf("found id %q, want %q", found.ID, created.ID)
		}
	})
}

func TestFindOrCreateUserByWoofx3UIUserIDCreatesOnceOnEveryDialect(t *testing.T) {
	dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
		created, err := models.FindOrCreateUserByWoofx3UIUserID(db, "ui-7")
		if err != nil {
			t.Fatalf("create: %v", err)
		}
		if created.ID == "" {
			t.Fatal("created user has no id")
		}
		found, err := models.FindOrCreateUserByWoofx3UIUserID(db, "ui-7")
		if err != nil {
			t.Fatalf("find: %v", err)
		}
		if found.ID != created.ID {
			t.Fatalf("found id %q, want %q", found.ID, created.ID)
		}
	})
}
