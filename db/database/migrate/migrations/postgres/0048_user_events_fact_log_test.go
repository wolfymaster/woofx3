package postgres

import (
	"strings"
	"testing"
	"time"

	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/models"
	"github.com/wolfymaster/woofx3/db/database/repository"
)

func TestUserEventsRebuildRecordsEachEventOnce(t *testing.T) {
	db := openEmptyPostgres(t)
	if err := gormigrate.New(db, gormigrate.DefaultOptions, All()).Migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	repo := repository.NewUserEventRepository(db)
	amount := int64(500)
	session := "7f0c5a1e-0000-4000-8000-000000000001"
	event := func() *models.UserEvent {
		return &models.UserEvent{
			ID:         uuid.New(),
			EventID:    "ce-1",
			Source:     "twitch",
			EventType:  "channel.cheer",
			Platform:   "twitch",
			SessionID:  &session,
			Amount:     &amount,
			EventValue: `{"amount":500}`,
			OccurredAt: time.Date(2026, 9, 27, 20, 0, 0, 0, time.UTC),
			CreatedAt:  time.Now().UTC(),
		}
	}

	first, created, err := repo.Record(event())
	if err != nil || !created {
		t.Fatalf("first Record: created=%v err=%v", created, err)
	}
	second, created, err := repo.Record(event())
	if err != nil {
		t.Fatalf("second Record: %v", err)
	}
	if created {
		t.Fatalf("created = true for a redelivered event")
	}
	if second.ID != first.ID {
		t.Fatalf("redelivery returned %s, want the original %s", second.ID, first.ID)
	}
	if !second.OccurredAt.Equal(first.OccurredAt) {
		t.Fatalf("occurred_at = %v, want %v", second.OccurredAt, first.OccurredAt)
	}
	if n := count(t, db, `SELECT COUNT(*) FROM user_events`); n != 1 {
		t.Fatalf("rows = %d, want 1", n)
	}
	if n := count(t, db, `SELECT COUNT(*) FROM user_events WHERE (event_value->>'amount')::int = 500`); n != 1 {
		t.Fatalf("event_value was not stored as JSON")
	}
}

func TestUserEventsRebuildRefusesToDiscardRows(t *testing.T) {
	db := openEmptyPostgres(t)
	if err := gormigrate.New(db, gormigrate.DefaultOptions, All()).MigrateTo("0047_drop_applications"); err != nil {
		t.Fatalf("migrate to 0047: %v", err)
	}
	mustExec(t, db, `INSERT INTO users (id, username, user_id) VALUES (?, 'wolfy', '42')`, testUserID)
	mustExec(t, db, `INSERT INTO user_events (user_id, event_type) VALUES (?, 'follow')`, testUserID)

	err := gormigrate.New(db, gormigrate.DefaultOptions, All()).Migrate()
	if err == nil || !strings.Contains(err.Error(), "will not discard") {
		t.Fatalf("err = %v, want a refusal to discard rows", err)
	}
	if n := count(t, db, `SELECT COUNT(*) FROM user_events`); n != 1 {
		t.Fatalf("user_events rows = %d, want the original 1", n)
	}
}
