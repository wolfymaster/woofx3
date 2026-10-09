package postgres

import (
	"testing"
	"time"

	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/repository"
)

// The SQLite chain covers the fold rules; this covers what Postgres types
// differently: uuid session ids compared against text window keys, and the
// row lock taken before a value is read.
func TestViewerFactsApplyPerSessionOnPostgres(t *testing.T) {
	db := openEmptyPostgres(t)
	if err := gormigrate.New(db, gormigrate.DefaultOptions, All()).Migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	start := time.Date(2026, 9, 27, 20, 0, 0, 0, time.UTC)
	first := uuid.New()
	second := uuid.New()
	mustExec(t, db, `INSERT INTO stream_sessions (id, status, started_at, ended_at) VALUES (?, 'closed', ?, ?)`, first, start, start.Add(time.Hour))
	mustExec(t, db, `INSERT INTO stream_session_segments (stream_session_id, started_at, ended_at) VALUES (?, ?, ?)`, first, start, start.Add(time.Hour))
	mustExec(t, db, `INSERT INTO stream_sessions (id, status, started_at) VALUES (?, 'open', ?)`, second, start.Add(24*time.Hour))
	mustExec(t, db, `INSERT INTO fact_definitions (id, name, definition, value_kind, window_kind)
		VALUES ('user:fact:streak', 'Streak', '{"sources":[],"aggregate":{"fn":"session_streak"}}', 'number', 'lifetime')`)

	repo := repository.NewViewerFactRepository(db)
	delta := repository.FactDelta{FactID: "user:fact:streak", Revision: 1, Platform: "twitch", SubjectID: "v1", Op: "session_streak"}
	for i, at := range []time.Time{start.Add(time.Minute), start.Add(24*time.Hour + time.Minute)} {
		result, err := repo.Apply(repository.FactBatch{Source: "twitch", EventID: uuid.NewString(), OccurredAt: at, Deltas: []repository.FactDelta{delta}})
		if err != nil {
			t.Fatalf("Apply %d: %v", i, err)
		}
		if len(result.Changes) != 1 || *result.Changes[0].After.Num != float64(i+1) {
			t.Fatalf("Apply %d = %+v, want streak %d", i, result, i+1)
		}
	}
	if got, err := repo.PreviousSessionID("stamp", start.Add(25*time.Hour)); err != nil || got != first.String() {
		t.Fatalf("PreviousSessionID(stamp) = %q, %v; want %s", got, err, first)
	}
}
