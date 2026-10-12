package postgres

import (
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/models"
	"github.com/wolfymaster/woofx3/db/database/repository"
	"gorm.io/gorm"
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
	mustExec(t, db, `INSERT INTO fact_definitions (id, name, definition, aggregate_fn, value_kind, window_kind)
		VALUES ('user:fact:streak', 'Streak', '{"sources":[],"aggregate":{"fn":"session_streak"}}', 'session_streak', 'number', 'lifetime')`)

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

func noFactOutbox(*gorm.DB, *models.FactDefinition, repository.FactDefinitionWrite) error {
	return nil
}

func factDefinition(where string) *models.FactDefinition {
	return &models.FactDefinition{
		ID:            "user:fact:messages",
		Name:          "Messages",
		Definition:    `{"sources":[{"trigger":"twitch:trigger:user_message","subject":"chatterId"` + where + `}],"aggregate":{"fn":"count"}}`,
		AggregateFn:   "count",
		ValueKind:     "number",
		WindowKind:    "lifetime",
		CreatedByType: "USER",
	}
}

// A revision bump deletes the fact's values, and an apply computed against
// the old revision must then be dropped. Were the revision check and the fold
// not serialized against the bump, an apply could pass the check before the
// bump commits and fold into values after it, leaving revision-1 counts under
// revision 2. Every apply here is revision 1, so whatever survives is such a
// leak. The deltas name viewers in different orders, which deadlocks unless
// applies lock values in one order.
func TestViewerFactRevisionBumpRacingApplyLeavesNoStaleValue(t *testing.T) {
	db := openEmptyPostgres(t)
	if err := gormigrate.New(db, gormigrate.DefaultOptions, All()).Migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	repo := repository.NewViewerFactRepository(db)
	if _, _, err := repo.UpsertDefinition(factDefinition(""), noFactOutbox); err != nil {
		t.Fatalf("define: %v", err)
	}

	const workers = 8
	const batches = 30
	viewers := []string{"v0", "v1", "v2", "v3", "v4"}
	errs := make(chan error, workers*batches+1)
	var wg sync.WaitGroup
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func(w int) {
			defer wg.Done()
			for b := 0; b < batches; b++ {
				deltas := make([]repository.FactDelta, len(viewers))
				for i := range viewers {
					viewer := viewers[(i*(w+1)+b)%len(viewers)]
					deltas[i] = repository.FactDelta{FactID: "user:fact:messages", Revision: 1, Platform: "twitch", SubjectID: viewer, Op: "count"}
				}
				_, err := repo.Apply(repository.FactBatch{
					Source: "twitch", EventID: fmt.Sprintf("w%d-b%d", w, b), OccurredAt: time.Now().UTC(), Deltas: deltas,
				})
				if err != nil {
					errs <- err
				}
			}
		}(w)
	}
	wg.Add(1)
	go func() {
		defer wg.Done()
		time.Sleep(20 * time.Millisecond)
		_, write, err := repo.UpsertDefinition(factDefinition(`,"where":{"path":"message","op":"contains","value":"a"}`), noFactOutbox)
		if err != nil {
			errs <- err
			return
		}
		if write != repository.FactDefinitionRevised {
			errs <- fmt.Errorf("bump wrote %v, want revised", write)
		}
	}()
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Errorf("concurrent apply or bump: %v", err)
	}

	if n := count(t, db, `SELECT COUNT(*) FROM fact_values`); n != 0 {
		t.Fatalf("values left after the bump = %d, want 0: revision-1 deltas folded into revision 2", n)
	}
}

func TestViewerFactConcurrentFirstSavesOfOneIdBothSucceed(t *testing.T) {
	db := openEmptyPostgres(t)
	if err := gormigrate.New(db, gormigrate.DefaultOptions, All()).Migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	repo := repository.NewViewerFactRepository(db)

	const savers = 6
	writes := make(chan repository.FactDefinitionWrite, savers)
	errs := make(chan error, savers)
	var wg sync.WaitGroup
	for i := 0; i < savers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, write, err := repo.UpsertDefinition(factDefinition(""), noFactOutbox)
			if err != nil {
				errs <- err
				return
			}
			writes <- write
		}()
	}
	wg.Wait()
	close(errs)
	close(writes)
	for err := range errs {
		t.Errorf("save: %v", err)
	}
	created := 0
	for write := range writes {
		if write == repository.FactDefinitionCreated {
			created++
		} else if write != repository.FactDefinitionUnchanged {
			t.Errorf("a concurrent identical save wrote %v", write)
		}
	}
	if created != 1 {
		t.Fatalf("created %d times, want once", created)
	}
}

// Fact ids run to 255 characters and are published as the outbox entity.
func TestOutboxHoldsAFactIDLongerThanAUUID(t *testing.T) {
	db := openEmptyPostgres(t)
	if err := gormigrate.New(db, gormigrate.DefaultOptions, All()).Migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	mustExec(t, db, `INSERT INTO worker_events (event_type, entity_type, entity_id, operation, payload, nats_subject)
		VALUES ('viewer.fact.upserted', 'viewer.fact', ?, 'upserted', '{}', 'db.viewer.fact.upserted.system')`,
		"twitch_platform:fact:subscription_months")
}
