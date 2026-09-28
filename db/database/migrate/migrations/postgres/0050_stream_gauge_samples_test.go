package postgres

import (
	"testing"
	"time"

	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/models"
	"github.com/wolfymaster/woofx3/db/database/repository"
)

func TestStreamGaugeSamplesRecordEachMinuteOnce(t *testing.T) {
	db := openEmptyPostgres(t)
	if err := gormigrate.New(db, gormigrate.DefaultOptions, All()).Migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	session := uuid.New()
	segment := uuid.New()
	minute := time.Date(2026, 9, 27, 20, 1, 0, 0, time.UTC)
	mustExec(t, db, `INSERT INTO stream_sessions (id, status, started_at) VALUES (?, 'open', ?)`, session, minute)
	mustExec(t, db, `INSERT INTO stream_session_segments (id, stream_session_id, started_at) VALUES (?, ?, ?)`, segment, session, minute)

	repo := repository.NewStreamGaugeRepository(db)
	viewers := int64(12)
	sample := func() *models.StreamGaugeSample {
		return &models.StreamGaugeSample{
			ID:          uuid.New(),
			SegmentID:   segment,
			SessionID:   session,
			SampledAt:   minute,
			ViewerCount: &viewers,
			CreatedAt:   time.Now().UTC(),
		}
	}

	first, created, err := repo.Record(sample())
	if err != nil || !created {
		t.Fatalf("first Record: created=%v err=%v", created, err)
	}
	second, created, err := repo.Record(sample())
	if err != nil {
		t.Fatalf("second Record: %v", err)
	}
	if created || second.ID != first.ID {
		t.Fatalf("second Record: created=%v id=%s, want the original %s", created, second.ID, first.ID)
	}

	listed, err := repo.ListForSession(session)
	if err != nil {
		t.Fatalf("ListForSession: %v", err)
	}
	if len(listed) != 1 || listed[0].FollowerTotal != nil {
		t.Fatalf("listed = %v, want the one sample with no follower total", listed)
	}

	if err := db.Exec(`INSERT INTO stream_gauge_samples (segment_id, session_id, sampled_at) VALUES (?, ?, ?)`,
		segment, session, minute.Add(time.Minute)).Error; err == nil {
		t.Fatalf("a sample with no metric was accepted")
	}
}
