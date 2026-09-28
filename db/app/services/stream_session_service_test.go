package services

import (
	"context"
	"testing"
	"time"

	"github.com/go-gormigrate/gormigrate/v2"
	client "github.com/wolfymaster/woofx3/clients/db"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// newStreamSessionSvc runs the real SQLite migration chain, so the column
// types the driver decodes timestamps from are the ones production has.
func newStreamSessionSvc(t *testing.T) client.StreamSessionService {
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
	return NewStreamSessionService(repo.NewStreamSessionRepository(db), nil)
}

func TestStreamSessionsReadBackOnSQLite(t *testing.T) {
	ctx := context.Background()
	svc := newStreamSessionSvc(t)

	state, err := svc.EnsureCurrentStreamSession(ctx, &client.EnsureCurrentStreamSessionRequest{})
	if err != nil {
		t.Fatalf("EnsureCurrentStreamSession: %v", err)
	}
	sessionID := state.Session.Id

	wentLive := time.Date(2026, 9, 27, 20, 0, 0, 0, time.UTC)
	wentDown := wentLive.Add(90 * time.Minute)
	if _, err := svc.OpenStreamSessionSegment(ctx, &client.OpenStreamSessionSegmentRequest{
		StreamSessionId: sessionID,
		StartedAt:       timestamppb.New(wentLive),
	}); err != nil {
		t.Fatalf("OpenStreamSessionSegment: %v", err)
	}
	closed, err := svc.CloseStreamSessionSegment(ctx, &client.CloseStreamSessionSegmentRequest{
		EndedAt: timestamppb.New(wentDown),
	})
	if err != nil {
		t.Fatalf("CloseStreamSessionSegment: %v", err)
	}
	if got := closed.Segment.StartedAt.AsTime(); !got.Equal(wentLive) {
		t.Fatalf("segment started_at = %v, want %v", got, wentLive)
	}
	if got := closed.Segment.EndedAt.AsTime(); !got.Equal(wentDown) {
		t.Fatalf("segment ended_at = %v, want %v", got, wentDown)
	}

	again, err := svc.EnsureCurrentStreamSession(ctx, &client.EnsureCurrentStreamSessionRequest{})
	if err != nil {
		t.Fatalf("EnsureCurrentStreamSession on an existing session: %v", err)
	}
	if again.Session.Id != sessionID {
		t.Fatalf("session id = %s, want the existing %s", again.Session.Id, sessionID)
	}
	if again.IsSegmentOpen {
		t.Fatalf("is_segment_open = true after the segment closed")
	}
	if got := again.LastSegmentEndedAt.AsTime(); !got.Equal(wentDown) {
		t.Fatalf("last_segment_ended_at = %v, want %v", got, wentDown)
	}

	got, err := svc.GetStreamSession(ctx, &client.GetStreamSessionRequest{Id: sessionID})
	if err != nil {
		t.Fatalf("GetStreamSession: %v", err)
	}
	if got.Session.StartedAt.AsTime().IsZero() {
		t.Fatalf("session started_at is zero")
	}

	listed, err := svc.ListStreamSessions(ctx, &client.ListStreamSessionsRequest{})
	if err != nil {
		t.Fatalf("ListStreamSessions: %v", err)
	}
	if len(listed.Sessions) != 1 || listed.Sessions[0].Id != sessionID {
		t.Fatalf("listed sessions = %v, want only %s", listed.Sessions, sessionID)
	}
}
