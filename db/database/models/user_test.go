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

// A caller that loses the race to create the same UI user gets the
// winner's row. The competing insert lands between this caller's lookup and
// its own insert, which then fails on the unique index.
func TestFindOrCreateUserByWoofx3UIUserIDReturnsTheRaceWinnersRow(t *testing.T) {
	dbtest.ForEachDialect(t, func(t *testing.T, db *gorm.DB) {
		const winnerID = "8d1c1f0e-3f7a-4c55-9a51-6c1d2e3f4a5b"
		err := db.Callback().Create().Before("gorm:create").Register("test:race_winner", func(tx *gorm.DB) {
			user, ok := tx.Statement.Dest.(*models.User)
			if !ok || user.Woofx3UIUserID != "ui-race" {
				return
			}
			winner := tx.Session(&gorm.Session{NewDB: true}).
				Exec(`INSERT INTO users (id, username, user_id, woofx3_ui_user_id) VALUES (?, '', '', ?)`, winnerID, "ui-race")
			if winner.Error != nil {
				t.Errorf("insert race winner: %v", winner.Error)
			}
		})
		if err != nil {
			t.Fatalf("register race callback: %v", err)
		}
		// Without the default transaction the winner's insert commits on
		// its own, as a concurrent caller's would.
		racing := db.Session(&gorm.Session{SkipDefaultTransaction: true})

		user, err := models.FindOrCreateUserByWoofx3UIUserID(racing, "ui-race")
		if err != nil {
			t.Fatalf("FindOrCreateUserByWoofx3UIUserID: %v", err)
		}
		if user.ID != winnerID {
			t.Fatalf("user id = %q, want the race winner's %q", user.ID, winnerID)
		}
	})
}
