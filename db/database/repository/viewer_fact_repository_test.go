package repository

import (
	"math"
	"testing"
	"time"

	"github.com/go-gormigrate/gormigrate/v2"
	gsqlite "github.com/libtnb/sqlite"
	"github.com/wolfymaster/woofx3/db/database"
	"github.com/wolfymaster/woofx3/db/database/migrate/migrations"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
)

var factEpoch = time.Date(2026, 9, 27, 20, 0, 0, 0, time.UTC)

// openFactDb runs the real SQLite migration chain, so the keys, cascades and
// timestamp columns are the ones production has.
func openFactDb(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(gsqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("sql db: %v", err)
	}
	// Every connection to :memory: is a separate database.
	sqlDB.SetMaxOpenConns(1)
	if err := db.Exec(`PRAGMA foreign_keys = ON`).Error; err != nil {
		t.Fatalf("enable foreign keys: %v", err)
	}
	chain, err := migrations.For(database.DialectSQLite)
	if err != nil {
		t.Fatalf("migrations.For: %v", err)
	}
	if err := gormigrate.New(db, migrations.Options, chain).Migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return db
}

func defineFact(t *testing.T, db *gorm.DB, id, fn, window string) {
	t.Helper()
	createFact(t, db, id, fn, models.FactValueKindNumber, window)
}

func defineKindFact(t *testing.T, db *gorm.DB, id, fn, valueKind string) {
	t.Helper()
	createFact(t, db, id, fn, valueKind, models.FactWindowLifetime)
}

func createFact(t *testing.T, db *gorm.DB, id, fn, valueKind, window string) {
	t.Helper()
	err := db.Create(&models.FactDefinition{
		ID:            id,
		Name:          id,
		Definition:    `{"sources":[{"trigger":"twitch:trigger:user_message","subject":"chatterId"}],"aggregate":{"fn":"` + fn + `"}}`,
		AggregateFn:   fn,
		ValueKind:     valueKind,
		WindowKind:    window,
		Revision:      1,
		CountingSince: factEpoch,
		CreatedAt:     factEpoch,
		UpdatedAt:     factEpoch,
	}).Error
	if err != nil {
		t.Fatalf("define %s: %v", id, err)
	}
}

// addSession inserts a closed session starting at `start`, live for an hour
// when `live`.
func addSession(t *testing.T, db *gorm.DB, id string, start time.Time, live bool) {
	t.Helper()
	if err := db.Exec(`INSERT INTO stream_sessions (id, status, started_at, ended_at) VALUES (?, 'closed', ?, ?)`,
		id, start.UTC(), start.Add(6*time.Hour).UTC()).Error; err != nil {
		t.Fatalf("session %s: %v", id, err)
	}
	if !live {
		return
	}
	if err := db.Exec(`INSERT INTO stream_session_segments (id, stream_session_id, started_at, ended_at) VALUES (?, ?, ?, ?)`,
		"11111111"+id[8:], id, start.UTC(), start.Add(time.Hour).UTC()).Error; err != nil {
		t.Fatalf("segment of %s: %v", id, err)
	}
}

func chatBatch(eventID string, at time.Time, deltas ...FactDelta) FactBatch {
	return FactBatch{Source: "twitch", EventID: eventID, OccurredAt: at, Deltas: deltas}
}

func countDelta(factID, viewer string) FactDelta {
	return FactDelta{FactID: factID, Revision: 1, Platform: "twitch", SubjectID: viewer, Op: models.FactAggregateCount}
}

func mustApply(t *testing.T, repo *ViewerFactRepository, batch FactBatch) *FactApplyResult {
	t.Helper()
	result, err := repo.Apply(batch)
	if err != nil {
		t.Fatalf("Apply(%s): %v", batch.EventID, err)
	}
	return result
}

func storedNum(t *testing.T, db *gorm.DB, factID, viewer, windowKey string) *float64 {
	t.Helper()
	var rows []models.FactValue
	if err := db.Where("fact_id = ? AND platform = 'twitch' AND subject_id = ? AND window_key = ?",
		factID, viewer, windowKey).Find(&rows).Error; err != nil {
		t.Fatalf("read value: %v", err)
	}
	if len(rows) == 0 {
		return nil
	}
	return rows[0].NumValue
}

func wantNum(t *testing.T, label string, got *float64, want float64) {
	t.Helper()
	if got == nil || *got != want {
		t.Fatalf("%s = %v, want %v", label, deref(got), want)
	}
}

func deref(v *float64) any {
	if v == nil {
		return "absent"
	}
	return *v
}

func TestApplyReportsTheValueBeforeAndAfter(t *testing.T) {
	db := openFactDb(t)
	defineFact(t, db, "user:fact:messages", models.FactAggregateCount, models.FactWindowLifetime)
	repo := NewViewerFactRepository(db)
	name := "Wolfy"
	delta := countDelta("user:fact:messages", "v1")
	delta.SubjectName = &name

	first := mustApply(t, repo, chatBatch("e1", factEpoch, delta))
	if !first.Applied || len(first.Changes) != 1 {
		t.Fatalf("first apply = %+v, want one change", first)
	}
	if change := first.Changes[0]; change.Before != nil || *change.After.Num != 1 || change.WindowKey != "" {
		t.Fatalf("first change = %+v, want absent -> 1 in the lifetime window", change)
	}

	second := mustApply(t, repo, chatBatch("e2", factEpoch.Add(time.Minute), countDelta("user:fact:messages", "v1")))
	change := second.Changes[0]
	if *change.Before.Num != 1 || *change.After.Num != 2 {
		t.Fatalf("second change = %v -> %v, want 1 -> 2", *change.Before.Num, *change.After.Num)
	}
	if change.SubjectName == nil || *change.SubjectName != "Wolfy" {
		t.Fatalf("subject name = %v, want the stored Wolfy kept", change.SubjectName)
	}
}

func TestApplyFansOneEventOutToEveryViewer(t *testing.T) {
	db := openFactDb(t)
	defineFact(t, db, "user:fact:messages", models.FactAggregateCount, models.FactWindowLifetime)
	repo := NewViewerFactRepository(db)

	result := mustApply(t, repo, chatBatch("e1", factEpoch,
		countDelta("user:fact:messages", "v1"), countDelta("user:fact:messages", "v2")))

	if len(result.Changes) != 2 {
		t.Fatalf("changes = %d, want 2", len(result.Changes))
	}
	wantNum(t, "v1", storedNum(t, db, "user:fact:messages", "v1", ""), 1)
	wantNum(t, "v2", storedNum(t, db, "user:fact:messages", "v2", ""), 1)
}

func TestARedeliveredEventChangesNothing(t *testing.T) {
	db := openFactDb(t)
	defineFact(t, db, "user:fact:messages", models.FactAggregateCount, models.FactWindowLifetime)
	repo := NewViewerFactRepository(db)
	mustApply(t, repo, chatBatch("e1", factEpoch, countDelta("user:fact:messages", "v1")))

	again := mustApply(t, repo, chatBatch("e1", factEpoch, countDelta("user:fact:messages", "v1")))

	if again.Applied || len(again.Changes) != 0 {
		t.Fatalf("redelivery = %+v, want not applied", again)
	}
	wantNum(t, "messages", storedNum(t, db, "user:fact:messages", "v1", ""), 1)
}

// A backfill replays events the live path may also apply, so it must neither
// be refused by nor leave a dedupe row.
func TestABackfillSkipsDedupe(t *testing.T) {
	db := openFactDb(t)
	defineFact(t, db, "user:fact:messages", models.FactAggregateCount, models.FactWindowLifetime)
	repo := NewViewerFactRepository(db)
	backfill := chatBatch("e1", factEpoch, countDelta("user:fact:messages", "v1"))
	backfill.SkipDedupe = true

	mustApply(t, repo, backfill)
	mustApply(t, repo, chatBatch("e1", factEpoch, countDelta("user:fact:messages", "v1")))

	wantNum(t, "messages", storedNum(t, db, "user:fact:messages", "v1", ""), 2)
}

func TestDeltasForAnotherRevisionOrAMissingFactAreDropped(t *testing.T) {
	db := openFactDb(t)
	defineFact(t, db, "user:fact:messages", models.FactAggregateCount, models.FactWindowLifetime)
	repo := NewViewerFactRepository(db)
	stale := countDelta("user:fact:messages", "v1")
	stale.Revision = 2

	result := mustApply(t, repo, chatBatch("e1", factEpoch, stale, countDelta("user:fact:gone", "v1")))

	if !result.Applied || result.Dropped != 2 || len(result.Changes) != 0 {
		t.Fatalf("result = %+v, want applied with both deltas dropped", result)
	}
	if got := storedNum(t, db, "user:fact:messages", "v1", ""); got != nil {
		t.Fatalf("value = %v, want absent", *got)
	}
}

// A delta that does not fit its definition is a caller bug confined to that
// delta: the rest of the event still applies, so one bad definition cannot
// stall every other fact the event feeds.
func TestADeltaThatDoesNotFitIsCountedAndTheRestApplies(t *testing.T) {
	db := openFactDb(t)
	defineFact(t, db, "user:fact:messages", models.FactAggregateCount, models.FactWindowLifetime)
	defineFact(t, db, "user:fact:bits", models.FactAggregateSum, models.FactWindowLifetime)
	defineKindFact(t, db, "user:fact:last_word", models.FactAggregateLast, models.FactValueKindString)
	repo := NewViewerFactRepository(db)
	wrongOp := countDelta("user:fact:messages", "v2")
	wrongOp.Op = models.FactAggregateLastAt
	noNumber := FactDelta{FactID: "user:fact:bits", Revision: 1, Platform: "twitch", SubjectID: "v1", Op: "sum"}
	infinite := FactDelta{FactID: "user:fact:bits", Revision: 1, Platform: "twitch", SubjectID: "v2", Op: "sum", Num: num(math.Inf(1))}
	both := FactDelta{FactID: "user:fact:last_word", Revision: 1, Platform: "twitch", SubjectID: "v1", Op: "last", Num: num(1), Str: str("a")}
	wrongKind := FactDelta{FactID: "user:fact:last_word", Revision: 1, Platform: "twitch", SubjectID: "v2", Op: "last", Num: num(1)}

	result := mustApply(t, repo, chatBatch("e1", factEpoch,
		countDelta("user:fact:messages", "v1"), wrongOp, noNumber, infinite, both, wrongKind))

	if !result.Applied || result.Invalid != 5 || len(result.Changes) != 1 {
		t.Fatalf("result = %+v, want five invalid and one change", result)
	}
	wantNum(t, "v1 messages", storedNum(t, db, "user:fact:messages", "v1", ""), 1)
	var n int64
	db.Model(&models.FactValue{}).Count(&n)
	if n != 1 {
		t.Fatalf("stored values = %d, want only v1's message count", n)
	}
}

// Each fact counts an event once per viewer, so a repeat of a (fact, viewer)
// within one batch is a caller bug: the first is applied, the rest counted.
func TestADuplicateViewerFactInABatchAppliesOnce(t *testing.T) {
	db := openFactDb(t)
	defineFact(t, db, "user:fact:messages", models.FactAggregateCount, models.FactWindowLifetime)
	defineFact(t, db, "user:fact:bits", models.FactAggregateSum, models.FactWindowLifetime)
	repo := NewViewerFactRepository(db)
	first := FactDelta{FactID: "user:fact:bits", Revision: 1, Platform: "twitch", SubjectID: "v1", Op: "sum", Num: num(5)}
	second := first
	second.Num = num(100)

	result := mustApply(t, repo, chatBatch("e1", factEpoch,
		first, countDelta("user:fact:messages", "v1"), second, countDelta("user:fact:messages", "v1")))

	if result.Invalid != 2 || len(result.Changes) != 2 {
		t.Fatalf("result = %+v, want two invalid and two changes", result)
	}
	wantNum(t, "bits", storedNum(t, db, "user:fact:bits", "v1", ""), 5)
	wantNum(t, "messages", storedNum(t, db, "user:fact:messages", "v1", ""), 1)
}

// A backfill replays events older than what live counting already stored.
func TestLastIgnoresAnOlderEvent(t *testing.T) {
	db := openFactDb(t)
	defineKindFact(t, db, "user:fact:last_word", models.FactAggregateLast, models.FactValueKindString)
	repo := NewViewerFactRepository(db)
	word := func(w string) FactDelta {
		return FactDelta{FactID: "user:fact:last_word", Revision: 1, Platform: "twitch", SubjectID: "v1", Op: "last", Str: str(w)}
	}

	mustApply(t, repo, chatBatch("e1", factEpoch.Add(time.Hour), word("newer")))
	older := mustApply(t, repo, chatBatch("e2", factEpoch, word("older")))
	newest := mustApply(t, repo, chatBatch("e3", factEpoch.Add(2*time.Hour), word("newest")))

	if len(older.Changes) != 0 {
		t.Fatalf("an older event changed %+v", older.Changes)
	}
	if len(newest.Changes) != 1 || *newest.Changes[0].Before.Str != "newer" || *newest.Changes[0].After.Str != "newest" {
		t.Fatalf("newest = %+v, want newer -> newest", newest.Changes)
	}
}

func TestDeletingADefinitionDeletesItsValues(t *testing.T) {
	db := openFactDb(t)
	defineFact(t, db, "user:fact:messages", models.FactAggregateCount, models.FactWindowLifetime)
	repo := NewViewerFactRepository(db)
	mustApply(t, repo, chatBatch("e1", factEpoch, countDelta("user:fact:messages", "v1")))

	if err := db.Exec(`DELETE FROM fact_definitions WHERE id = 'user:fact:messages'`).Error; err != nil {
		t.Fatalf("delete: %v", err)
	}
	var n int64
	db.Model(&models.FactValue{}).Count(&n)
	if n != 0 {
		t.Fatalf("values after deleting the definition = %d, want 0", n)
	}
}

const (
	sessionA = "00000000-0000-0000-0000-00000000aaaa"
	sessionB = "00000000-0000-0000-0000-00000000bbbb"
	sessionC = "00000000-0000-0000-0000-00000000cccc"
	sessionD = "00000000-0000-0000-0000-00000000dddd"
	sessionE = "00000000-0000-0000-0000-00000000eeee"
)

// Sessions a day apart: A, B and D went live, C never did.
func addSessions(t *testing.T, db *gorm.DB) {
	t.Helper()
	addSession(t, db, sessionA, factEpoch, true)
	addSession(t, db, sessionB, factEpoch.Add(24*time.Hour), true)
	addSession(t, db, sessionC, factEpoch.Add(48*time.Hour), false)
	addSession(t, db, sessionD, factEpoch.Add(72*time.Hour), true)
	addSession(t, db, sessionE, factEpoch.Add(96*time.Hour), true)
}

func inSession(day int) time.Time {
	return factEpoch.Add(time.Duration(day)*24*time.Hour + 30*time.Minute)
}

func TestASessionValueIsKeptPerOwningSession(t *testing.T) {
	db := openFactDb(t)
	addSessions(t, db)
	defineFact(t, db, "user:fact:stream_messages", models.FactAggregateCount, models.FactWindowSession)
	repo := NewViewerFactRepository(db)

	mustApply(t, repo, chatBatch("e1", inSession(0), countDelta("user:fact:stream_messages", "v1")))
	mustApply(t, repo, chatBatch("e2", inSession(0), countDelta("user:fact:stream_messages", "v1")))
	result := mustApply(t, repo, chatBatch("e3", inSession(1), countDelta("user:fact:stream_messages", "v1")))

	if key := result.Changes[0].WindowKey; key != sessionB {
		t.Fatalf("window key = %s, want session B", key)
	}
	wantNum(t, "session A", storedNum(t, db, "user:fact:stream_messages", "v1", sessionA), 2)
	wantNum(t, "session B", storedNum(t, db, "user:fact:stream_messages", "v1", sessionB), 1)
}

func TestTheStampIsUsedOnlyWhenNoSessionHadStarted(t *testing.T) {
	db := openFactDb(t)
	addSessions(t, db)
	defineFact(t, db, "user:fact:stream_messages", models.FactAggregateCount, models.FactWindowSession)
	repo := NewViewerFactRepository(db)

	stamped := chatBatch("e1", inSession(1), countDelta("user:fact:stream_messages", "v1"))
	stamped.SessionStamp = sessionA
	early := chatBatch("e2", factEpoch.Add(-time.Hour), countDelta("user:fact:stream_messages", "v1"))
	early.SessionStamp = "stamp"
	unowned := chatBatch("e3", factEpoch.Add(-time.Hour), countDelta("user:fact:stream_messages", "v1"))

	if key := mustApply(t, repo, stamped).Changes[0].WindowKey; key != sessionB {
		t.Fatalf("stamped window key = %s, want the owning session B", key)
	}
	if key := mustApply(t, repo, early).Changes[0].WindowKey; key != "stamp" {
		t.Fatalf("early window key = %s, want the stamp", key)
	}
	if result := mustApply(t, repo, unowned); !result.Applied || result.Skipped != 1 || len(result.Changes) != 0 {
		t.Fatalf("unowned = %+v, want applied and skipped", result)
	}
}

func TestSessionsCountsEachSessionOnce(t *testing.T) {
	db := openFactDb(t)
	addSessions(t, db)
	defineFact(t, db, "user:fact:streams", models.FactAggregateSessions, models.FactWindowLifetime)
	repo := NewViewerFactRepository(db)
	delta := FactDelta{FactID: "user:fact:streams", Revision: 1, Platform: "twitch", SubjectID: "v1", Op: models.FactAggregateSessions}

	mustApply(t, repo, chatBatch("e1", inSession(0), delta))
	if again := mustApply(t, repo, chatBatch("e2", inSession(0), delta)); len(again.Changes) != 0 {
		t.Fatalf("a second event in the same session changed %+v", again.Changes)
	}
	result := mustApply(t, repo, chatBatch("e3", inSession(3), delta))

	change := result.Changes[0]
	if *change.Before.Num != 1 || *change.After.Num != 2 || *change.After.Str != sessionD {
		t.Fatalf("change = %v -> %v (%s), want 1 -> 2 in session D", *change.Before.Num, *change.After.Num, *change.After.Str)
	}
}

func TestSessionStreakSkipsSessionsThatNeverWentLive(t *testing.T) {
	db := openFactDb(t)
	addSessions(t, db)
	defineFact(t, db, "user:fact:streak", models.FactAggregateSessionStreak, models.FactWindowLifetime)
	repo := NewViewerFactRepository(db)
	delta := FactDelta{FactID: "user:fact:streak", Revision: 1, Platform: "twitch", SubjectID: "v1", Op: models.FactAggregateSessionStreak}

	mustApply(t, repo, chatBatch("e1", inSession(0), delta))
	mustApply(t, repo, chatBatch("e2", inSession(1), delta))
	mustApply(t, repo, chatBatch("e3", inSession(3), delta))

	wantNum(t, "streak across A, B, (C), D", storedNum(t, db, "user:fact:streak", "v1", ""), 3)
}

func TestSessionStreakResetsAfterAMissedLiveSession(t *testing.T) {
	db := openFactDb(t)
	addSessions(t, db)
	defineFact(t, db, "user:fact:streak", models.FactAggregateSessionStreak, models.FactWindowLifetime)
	repo := NewViewerFactRepository(db)
	delta := FactDelta{FactID: "user:fact:streak", Revision: 1, Platform: "twitch", SubjectID: "v1", Op: models.FactAggregateSessionStreak}

	mustApply(t, repo, chatBatch("e1", inSession(0), delta))
	mustApply(t, repo, chatBatch("e2", inSession(1), delta))
	result := mustApply(t, repo, chatBatch("e3", inSession(4), delta))

	change := result.Changes[0]
	if *change.Before.Num != 2 || *change.After.Num != 1 || *change.After.Str != sessionE {
		t.Fatalf("change = %v -> %v (%s), want 2 -> 1 in session E", *change.Before.Num, *change.After.Num, *change.After.Str)
	}
}

func TestPreviousSessionIDOfTheFirstSessionIsEmpty(t *testing.T) {
	db := openFactDb(t)
	addSessions(t, db)
	repo := NewViewerFactRepository(db)

	if got, err := repo.PreviousSessionID(sessionA, inSession(0)); err != nil || got != "" {
		t.Fatalf("PreviousSessionID(A) = %q, %v; want empty", got, err)
	}
	if got, err := repo.PreviousSessionID("not-a-session", inSession(2)); err != nil || got != sessionB {
		t.Fatalf("PreviousSessionID(stamp during C) = %q, %v; want B", got, err)
	}
}

func TestSessionAggregatesIgnoreAnEarlierSession(t *testing.T) {
	db := openFactDb(t)
	addSessions(t, db)
	defineFact(t, db, "user:fact:streams", models.FactAggregateSessions, models.FactWindowLifetime)
	defineFact(t, db, "user:fact:streak", models.FactAggregateSessionStreak, models.FactWindowLifetime)
	repo := NewViewerFactRepository(db)
	deltas := []FactDelta{
		{FactID: "user:fact:streams", Revision: 1, Platform: "twitch", SubjectID: "v1", Op: models.FactAggregateSessions},
		{FactID: "user:fact:streak", Revision: 1, Platform: "twitch", SubjectID: "v1", Op: models.FactAggregateSessionStreak},
	}

	mustApply(t, repo, chatBatch("e1", inSession(3), deltas...))
	late := mustApply(t, repo, chatBatch("e2", inSession(1), deltas...))
	next := mustApply(t, repo, chatBatch("e3", inSession(4), deltas...))

	if len(late.Changes) != 0 {
		t.Fatalf("an event from an earlier session changed %+v", late.Changes)
	}
	wantNum(t, "streams", storedNum(t, db, "user:fact:streams", "v1", ""), 2)
	wantNum(t, "streak", storedNum(t, db, "user:fact:streak", "v1", ""), 2)
	if len(next.Changes) != 2 {
		t.Fatalf("next = %+v, want both aggregates to count session E", next.Changes)
	}
}

func num(v float64) *float64 {
	return &v
}

func str(v string) *string {
	return &v
}

func TestFactFoldPerAggregate(t *testing.T) {
	at := factEpoch.Add(time.Hour)
	ms := float64(at.UnixMilli())
	cases := []struct {
		name   string
		fold   FactFold
		before *FactValueState
		want   FactValueState
	}{
		{"count from nothing", FactFold{Op: "count"}, nil, FactValueState{Num: num(1)}},
		{"count ignores num", FactFold{Op: "count", Num: num(9)}, &FactValueState{Num: num(4)}, FactValueState{Num: num(5)}},
		{"sum", FactFold{Op: "sum", Num: num(2.5)}, &FactValueState{Num: num(4)}, FactValueState{Num: num(6.5)}},
		{"min keeps lower", FactFold{Op: "min", Num: num(7)}, &FactValueState{Num: num(4)}, FactValueState{Num: num(4)}},
		{"min takes lower", FactFold{Op: "min", Num: num(1)}, &FactValueState{Num: num(4)}, FactValueState{Num: num(1)}},
		{"max from nothing", FactFold{Op: "max", Num: num(3)}, nil, FactValueState{Num: num(3)}},
		{"max takes higher", FactFold{Op: "max", Num: num(9)}, &FactValueState{Num: num(4)}, FactValueState{Num: num(9)}},
		{"last string", FactFold{Op: "last", Str: str("hi")}, &FactValueState{Str: str("yo")}, FactValueState{Str: str("hi")}},
		{"last number", FactFold{Op: "last", Num: num(3)}, nil, FactValueState{Num: num(3)}},
		{"first_at from nothing", FactFold{Op: "first_at", OccurredAt: at}, nil, FactValueState{Num: num(ms)}},
		{"first_at keeps earlier", FactFold{Op: "first_at", OccurredAt: at}, &FactValueState{Num: num(ms - 1)}, FactValueState{Num: num(ms - 1)}},
		{"last_at takes later", FactFold{Op: "last_at", OccurredAt: at}, &FactValueState{Num: num(ms - 1)}, FactValueState{Num: num(ms)}},
		{"last_at keeps later", FactFold{Op: "last_at", OccurredAt: at}, &FactValueState{Num: num(ms + 1)}, FactValueState{Num: num(ms + 1)}},
		{"sessions new", FactFold{Op: "sessions", SessionID: "b"}, &FactValueState{Num: num(3), Str: str("a")}, FactValueState{Num: num(4), Str: str("b")}},
		{"sessions same", FactFold{Op: "sessions", SessionID: "a"}, &FactValueState{Num: num(3), Str: str("a")}, FactValueState{Num: num(3), Str: str("a")}},
		{"streak continues", FactFold{Op: "session_streak", SessionID: "b", PreviousSessionID: "a"}, &FactValueState{Num: num(3), Str: str("a")}, FactValueState{Num: num(4), Str: str("b")}},
		{"streak resets", FactFold{Op: "session_streak", SessionID: "c", PreviousSessionID: "b"}, &FactValueState{Num: num(3), Str: str("a")}, FactValueState{Num: num(1), Str: str("c")}},
		{"streak starts", FactFold{Op: "session_streak", SessionID: "a"}, nil, FactValueState{Num: num(1), Str: str("a")}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := tc.fold.Apply(tc.before)
			if err != nil {
				t.Fatalf("Apply: %v", err)
			}
			if !equalState(got, &tc.want) {
				t.Fatalf("got num=%v str=%v, want num=%v str=%v", deref(got.Num), got.Str, deref(tc.want.Num), tc.want.Str)
			}
		})
	}
}

func TestFactFoldRefusesMissingInputs(t *testing.T) {
	cases := []FactFold{
		{Op: "sum"},
		{Op: "min"},
		{Op: "max", Num: num(math.NaN())},
		{Op: "sum", Num: num(math.Inf(1))},
		{Op: "last"},
		{Op: "sessions"},
		{Op: "session_streak"},
		{Op: "median", Num: num(1)},
	}
	for _, fold := range cases {
		if _, err := fold.Apply(nil); err == nil {
			t.Errorf("%+v was accepted", fold)
		}
	}
}
