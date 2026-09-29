package services

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/database/models"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

// newUserEventSvc runs the real SQLite migration chain, so the unique
// constraint the idempotency depends on is the one production has.
func newUserEventSvc(t *testing.T) (client.UserEventService, *gorm.DB) {
	t.Helper()
	db := openEmptySQLite(t)
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("sql db: %v", err)
	}
	// Every connection to :memory: is a separate database.
	sqlDB.SetMaxOpenConns(1)
	if err := gormigrate.New(db, gormigrate.DefaultOptions, sqliteChain(t)).Migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return NewUserEventService(repo.NewUserEventRepository(db), repo.NewStreamSessionRepository(db)), db
}

func strPtr(s string) *string {
	return &s
}

func int64Ptr(n int64) *int64 {
	return &n
}

func cheerRequest(eventID string) *client.RecordUserEventRequest {
	return &client.RecordUserEventRequest{
		EventId:        eventID,
		Source:         "twitch",
		EventType:      "channel.cheer",
		Platform:       "twitch",
		PlatformUserId: strPtr("1001"),
		UserName:       strPtr("Viewer"),
		SessionId:      strPtr("7f0c5a1e-0000-4000-8000-000000000001"),
		Amount:         int64Ptr(500),
		EventValue:     `{"amount":500,"isAnonymous":false,"userId":"1001"}`,
		OccurredAt:     timestamppb.New(time.Date(2026, 9, 27, 20, 0, 0, 0, time.UTC)),
	}
}

func countUserEvents(t *testing.T, db *gorm.DB) int64 {
	t.Helper()
	var n int64
	if err := db.Model(&models.UserEvent{}).Count(&n).Error; err != nil {
		t.Fatalf("count user_events: %v", err)
	}
	return n
}

func TestRecordUserEventStoresTheEvent(t *testing.T) {
	svc, db := newUserEventSvc(t)
	req := cheerRequest("ce-1")

	resp, err := svc.RecordUserEvent(context.Background(), req)
	if err != nil {
		t.Fatalf("RecordUserEvent: %v", err)
	}
	if !resp.Created {
		t.Fatalf("created = false for a new event")
	}

	var stored models.UserEvent
	if err := db.First(&stored, "event_id = ?", "ce-1").Error; err != nil {
		t.Fatalf("read back: %v", err)
	}
	if stored.SessionID == nil || *stored.SessionID != *req.SessionId {
		t.Fatalf("session_id = %v, want %q", stored.SessionID, *req.SessionId)
	}
	if stored.Amount == nil || *stored.Amount != 500 {
		t.Fatalf("amount = %v, want 500", stored.Amount)
	}
	if stored.PlatformUserID == nil || *stored.PlatformUserID != "1001" {
		t.Fatalf("platform_user_id = %v, want 1001", stored.PlatformUserID)
	}
	if !stored.OccurredAt.Equal(req.OccurredAt.AsTime()) {
		t.Fatalf("occurred_at = %v, want %v", stored.OccurredAt, req.OccurredAt.AsTime())
	}
	if resp.Event.Id != stored.ID.String() {
		t.Fatalf("response id = %q, stored id = %q", resp.Event.Id, stored.ID)
	}
}

func TestRecordingTheSameEventTwiceKeepsOneRow(t *testing.T) {
	svc, db := newUserEventSvc(t)
	ctx := context.Background()

	first, err := svc.RecordUserEvent(ctx, cheerRequest("ce-dup"))
	if err != nil {
		t.Fatalf("first RecordUserEvent: %v", err)
	}

	redelivery := cheerRequest("ce-dup")
	redelivery.Amount = int64Ptr(9999)
	second, err := svc.RecordUserEvent(ctx, redelivery)
	if err != nil {
		t.Fatalf("second RecordUserEvent: %v", err)
	}

	if second.Created {
		t.Fatalf("created = true for a redelivered event")
	}
	if n := countUserEvents(t, db); n != 1 {
		t.Fatalf("rows = %d, want 1", n)
	}
	if second.Event.Id != first.Event.Id {
		t.Fatalf("redelivery returned row %q, want the original %q", second.Event.Id, first.Event.Id)
	}
	if second.Event.Amount == nil || *second.Event.Amount != 500 {
		t.Fatalf("redelivery changed the stored amount to %v", second.Event.Amount)
	}
}

func TestTheSameEventIDFromAnotherSourceIsADifferentEvent(t *testing.T) {
	svc, db := newUserEventSvc(t)
	ctx := context.Background()

	if _, err := svc.RecordUserEvent(ctx, cheerRequest("ce-shared")); err != nil {
		t.Fatalf("RecordUserEvent: %v", err)
	}
	other := cheerRequest("ce-shared")
	other.Source = "streamlabs"
	resp, err := svc.RecordUserEvent(ctx, other)
	if err != nil {
		t.Fatalf("RecordUserEvent: %v", err)
	}

	if !resp.Created {
		t.Fatalf("created = false; CloudEvent identity is source plus id")
	}
	if n := countUserEvents(t, db); n != 2 {
		t.Fatalf("rows = %d, want 2", n)
	}
}

func TestAnAnonymousEventIsStoredWithoutAViewer(t *testing.T) {
	svc, db := newUserEventSvc(t)
	ctx := context.Background()

	if _, err := svc.RecordUserEvent(ctx, cheerRequest("ce-named")); err != nil {
		t.Fatalf("RecordUserEvent: %v", err)
	}
	anonymous := cheerRequest("ce-anon")
	anonymous.PlatformUserId = nil
	anonymous.UserName = nil
	anonymous.Amount = int64Ptr(100)
	anonymous.EventValue = `{"amount":100,"isAnonymous":true,"userId":null}`
	resp, err := svc.RecordUserEvent(ctx, anonymous)
	if err != nil {
		t.Fatalf("RecordUserEvent: %v", err)
	}
	if resp.Event.PlatformUserId != nil {
		t.Fatalf("platform_user_id = %q, want absent", *resp.Event.PlatformUserId)
	}

	// Channel totals include it; nothing groups it under a viewer.
	var total int64
	if err := db.Raw(`SELECT SUM(amount) FROM user_events WHERE event_type = 'channel.cheer'`).
		Scan(&total).Error; err != nil {
		t.Fatalf("sum: %v", err)
	}
	if total != 600 {
		t.Fatalf("channel bits = %d, want 600", total)
	}
	var viewers []struct {
		PlatformUserID string
		Bits           int64
	}
	if err := db.Raw(`SELECT platform_user_id, SUM(amount) AS bits FROM user_events
		WHERE platform_user_id IS NOT NULL GROUP BY platform_user_id`).Scan(&viewers).Error; err != nil {
		t.Fatalf("per viewer: %v", err)
	}
	if len(viewers) != 1 || viewers[0].PlatformUserID != "1001" || viewers[0].Bits != 500 {
		t.Fatalf("per-viewer totals = %+v, want only 1001 with 500", viewers)
	}
}

func TestAnEventWithoutASessionIsStillRecorded(t *testing.T) {
	svc, _ := newUserEventSvc(t)
	req := cheerRequest("ce-unstamped")
	req.SessionId = nil

	resp, err := svc.RecordUserEvent(context.Background(), req)
	if err != nil {
		t.Fatalf("RecordUserEvent: %v", err)
	}
	if resp.Event.SessionId != nil {
		t.Fatalf("session_id = %q, want absent", *resp.Event.SessionId)
	}
}

func TestRecordUserEventDefaultsTheOptionalFields(t *testing.T) {
	svc, _ := newUserEventSvc(t)
	req := cheerRequest("ce-bare")
	req.EventValue = ""
	req.OccurredAt = nil
	req.Amount = nil
	before := time.Now().UTC().Add(-time.Second)

	resp, err := svc.RecordUserEvent(context.Background(), req)
	if err != nil {
		t.Fatalf("RecordUserEvent: %v", err)
	}
	if resp.Event.EventValue != "{}" {
		t.Fatalf("event_value = %q, want {}", resp.Event.EventValue)
	}
	if resp.Event.Amount != nil {
		t.Fatalf("amount = %d, want absent", *resp.Event.Amount)
	}
	if resp.Event.OccurredAt.AsTime().Before(before) {
		t.Fatalf("occurred_at = %v, want about now", resp.Event.OccurredAt.AsTime())
	}
}

func TestRecordUserEventRejectsMalformedRequests(t *testing.T) {
	cases := map[string]func(*client.RecordUserEventRequest){
		"missing event_id":       func(r *client.RecordUserEventRequest) { r.EventId = "" },
		"missing source":         func(r *client.RecordUserEventRequest) { r.Source = "" },
		"missing event_type":     func(r *client.RecordUserEventRequest) { r.EventType = "" },
		"missing platform":       func(r *client.RecordUserEventRequest) { r.Platform = "" },
		"empty platform_user_id": func(r *client.RecordUserEventRequest) { r.PlatformUserId = strPtr("") },
		"empty session_id":       func(r *client.RecordUserEventRequest) { r.SessionId = strPtr("") },
		"negative amount":        func(r *client.RecordUserEventRequest) { r.Amount = int64Ptr(-1) },
		"invalid JSON":           func(r *client.RecordUserEventRequest) { r.EventValue = "{not json" },
		"over-long event_type": func(r *client.RecordUserEventRequest) {
			r.EventType = string(make([]byte, userEventTypeMaxLen+1))
		},
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			svc, db := newUserEventSvc(t)
			req := cheerRequest("ce-bad")
			mutate(req)

			_, err := svc.RecordUserEvent(context.Background(), req)
			var twerr twirp.Error
			if !errors.As(err, &twerr) {
				t.Fatalf("err = %v, want a twirp error", err)
			}
			if twerr.Code() != twirp.InvalidArgument {
				t.Fatalf("code = %s, want %s", twerr.Code(), twirp.InvalidArgument)
			}
			if n := countUserEvents(t, db); n != 0 {
				t.Fatalf("rows = %d, want 0", n)
			}
		})
	}
}
