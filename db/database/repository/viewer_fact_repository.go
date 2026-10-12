package repository

import (
	"cmp"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"reflect"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ViewerFactRepository wraps gorm.DB with the per-viewer fact tables:
// definitions, values, and the events already applied to them.
type ViewerFactRepository struct {
	db *gorm.DB
}

func NewViewerFactRepository(db *gorm.DB) *ViewerFactRepository {
	return &ViewerFactRepository{db: db}
}

// FactDelta is one event's contribution to one viewer's value of one fact.
//
// Op must be the aggregate function of the definition at Revision; the
// caller computed the delta from that definition. Num and Str carry the value
// the aggregate reads: Num for sum, min and max, exactly one for last (the
// one the definition's value kind names), neither for the rest.
type FactDelta struct {
	FactID      string
	Revision    int64
	Platform    string
	SubjectID   string
	SubjectName *string
	Op          string
	Num         *float64
	Str         *string
}

// FactBatch is every delta one event produced, applied together.
//
// Source and EventID are the CloudEvent's identity. SessionStamp is the
// stream session the event was stamped with, used only when no
// stream_sessions row owns OccurredAt. SkipDedupe is for a backfill, which
// replays events the live path may also have seen and so must not record
// them as applied.
type FactBatch struct {
	Source       string
	EventID      string
	OccurredAt   time.Time
	SessionStamp string
	SkipDedupe   bool
	Deltas       []FactDelta
}

// FactValueState is a stored value. A nil *FactValueState is a value that
// does not exist yet. At is value_at_ms: when the value was last folded, in
// epoch milliseconds. Two states are the same value when Num and Str agree,
// whatever their At.
type FactValueState struct {
	Num *float64
	Str *string
	At  *int64
}

// FactChange is a value an apply changed, with what it was and what it is.
type FactChange struct {
	FactID      string
	Platform    string
	SubjectID   string
	WindowKey   string
	SubjectName *string
	Before      *FactValueState
	After       *FactValueState
}

// FactApplyResult is the outcome of applying a batch. Applied is false when
// the event had been applied before, in which case nothing was written.
//
// Every delta of an applied batch is folded or counted in exactly one of:
//   - Dropped: computed against a revision that is no longer current, or a
//     definition that no longer exists. Expected while definitions change.
//   - Invalid: does not fit its definition (another op, missing or
//     non-finite input, a value of another kind), or repeats the fact and
//     viewer of an earlier delta in the batch. A caller bug; the rest of the
//     batch still applies.
//   - Skipped: needs a stream session and none had started, with no stamp.
type FactApplyResult struct {
	Applied bool
	Changes []FactChange
	Dropped int
	Invalid int
	Skipped int
}

// Apply folds a batch into fact_values in one transaction.
//
// The dedupe row is the first write, so a redelivered event is refused before
// anything else is read. The batch's definitions are then read under a share
// lock in id order, so a concurrent revision bump (which takes them for
// update and wipes their values) runs wholly before or after this apply,
// never between the revision check and the fold. Deltas are applied in
// (fact, platform, subject) order, so two batches lock shared values in one
// order and cannot deadlock.
func (r *ViewerFactRepository) Apply(batch FactBatch) (*FactApplyResult, error) {
	if batch.OccurredAt.IsZero() {
		return nil, errors.New("fact batch: occurred_at is required")
	}
	if !batch.SkipDedupe && (batch.Source == "" || batch.EventID == "") {
		return nil, errors.New("fact batch: source and event_id are required")
	}

	deltas := slices.Clone(batch.Deltas)
	slices.SortStableFunc(deltas, func(a, b FactDelta) int {
		return cmp.Or(
			cmp.Compare(a.FactID, b.FactID),
			cmp.Compare(a.Platform, b.Platform),
			cmp.Compare(a.SubjectID, b.SubjectID),
		)
	})

	result := &FactApplyResult{Changes: []FactChange{}}
	err := r.db.Transaction(func(tx *gorm.DB) error {
		txRepo := &ViewerFactRepository{db: tx}
		if !batch.SkipDedupe {
			first, err := txRepo.markEventApplied(batch.Source, batch.EventID)
			if err != nil {
				return err
			}
			if !first {
				return nil
			}
		}
		result.Applied = true

		definitions, err := txRepo.definitionsFor(deltas)
		if err != nil {
			return err
		}
		sessions := &sessionResolver{repo: txRepo, occurredAt: batch.OccurredAt, stamp: batch.SessionStamp}
		for i, delta := range deltas {
			definition, ok := definitions[delta.FactID]
			if !ok || definition.revision != delta.Revision {
				result.Dropped++
				continue
			}
			// Within one batch the window is the same for every delta of a
			// fact, so (fact, platform, subject) is the value's whole key. The
			// stable sort keeps the first of the duplicates first.
			if i > 0 && sameViewerFact(deltas[i-1], delta) {
				result.Invalid++
				continue
			}
			if err := definition.check(delta); err != nil {
				result.Invalid++
				continue
			}
			outcome, change, err := txRepo.applyDelta(delta, definition, batch.OccurredAt, sessions)
			if err != nil {
				return err
			}
			switch outcome {
			case deltaSkipped:
				result.Skipped++
			case deltaInvalid:
				result.Invalid++
			case deltaFolded:
				if change != nil {
					result.Changes = append(result.Changes, *change)
				}
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

func sameViewerFact(a, b FactDelta) bool {
	return a.FactID == b.FactID && a.Platform == b.Platform && a.SubjectID == b.SubjectID
}

// markEventApplied records (source, event_id) and reports whether this call
// was the first to. The unique key resolves the race, so two deliveries of
// one event in flight together still apply it once.
func (r *ViewerFactRepository) markEventApplied(source, eventID string) (bool, error) {
	result := r.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "source"}, {Name: "event_id"}},
		DoNothing: true,
	}).Create(&models.FactAppliedEvent{
		Source:    source,
		EventID:   eventID,
		AppliedAt: time.Now().UTC(),
	})
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected == 1, nil
}

type deltaDefinition struct {
	revision   int64
	windowKind string
	valueKind  string
	fn         string
}

// check reports why a delta does not fit the definition, or nil.
func (d deltaDefinition) check(delta FactDelta) error {
	if delta.Op != d.fn {
		return fmt.Errorf("op %q, definition folds with %q", delta.Op, d.fn)
	}
	finite := func(v *float64) bool {
		return v == nil || (!math.IsNaN(*v) && !math.IsInf(*v, 0))
	}
	if !finite(delta.Num) {
		return fmt.Errorf("%s needs a finite number, got %v", d.fn, *delta.Num)
	}
	switch d.fn {
	case models.FactAggregateSum, models.FactAggregateMin, models.FactAggregateMax:
		if delta.Num == nil || delta.Str != nil {
			return fmt.Errorf("%s needs a number and nothing else", d.fn)
		}
	case models.FactAggregateLast:
		if (delta.Num == nil) == (delta.Str == nil) {
			return errors.New("last needs a number or a string, not both or neither")
		}
		if (delta.Num != nil) != (d.valueKind == models.FactValueKindNumber) {
			return fmt.Errorf("last stores a %s", d.valueKind)
		}
	}
	return nil
}

// definitionsFor reads the definitions the deltas name under a share lock,
// in id order. SQLite takes no row locks; its single writer serializes the
// transactions instead.
func (r *ViewerFactRepository) definitionsFor(deltas []FactDelta) (map[string]deltaDefinition, error) {
	ids := make([]string, 0, len(deltas))
	seen := make(map[string]bool, len(deltas))
	for _, delta := range deltas {
		if !seen[delta.FactID] {
			seen[delta.FactID] = true
			ids = append(ids, delta.FactID)
		}
	}
	found := make(map[string]deltaDefinition, len(ids))
	if len(ids) == 0 {
		return found, nil
	}
	var rows []*models.FactDefinition
	if err := r.db.Clauses(clause.Locking{Strength: "SHARE"}).
		Select("id", "revision", "window_kind", "value_kind", "aggregate_fn").
		Where("id IN ?", ids).
		Order("id ASC").
		Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		found[row.ID] = deltaDefinition{
			revision:   row.Revision,
			windowKind: row.WindowKind,
			valueKind:  row.ValueKind,
			fn:         row.AggregateFn,
		}
	}
	return found, nil
}

// SessionRef is the stream session an instant belongs to.
type SessionRef struct {
	ID        string
	StartedAt time.Time
}

// sessionResolver looks the batch's sessions up at most once each, since
// every delta of a batch shares one occurred_at.
type sessionResolver struct {
	repo       *ViewerFactRepository
	occurredAt time.Time
	stamp      string

	current  *SessionRef
	previous *string
}

func (s *sessionResolver) currentSession() (SessionRef, error) {
	if s.current == nil {
		session, err := s.repo.SessionAt(s.occurredAt, s.stamp)
		if err != nil {
			return SessionRef{}, err
		}
		s.current = &session
	}
	return *s.current, nil
}

func (s *sessionResolver) previousID() (string, error) {
	if s.previous == nil {
		current, err := s.currentSession()
		if err != nil {
			return "", err
		}
		id, err := s.repo.PreviousSessionID(current.ID, s.occurredAt)
		if err != nil {
			return "", err
		}
		s.previous = &id
	}
	return *s.previous, nil
}

// SessionAt returns the stream session owning `at`: the one with the latest
// started_at at or before it. A session owns everything from its start to the
// next session's start, which is what a split preserves. Falls back to stamp,
// taken to start at `at`, when no session started by then; the ID is "" when
// the stamp is empty too.
func (r *ViewerFactRepository) SessionAt(at time.Time, stamp string) (SessionRef, error) {
	var sessions []models.StreamSession
	if err := r.db.Select("id", "started_at").
		Where("started_at <= ?", at.UTC()).
		Order("started_at DESC").
		Limit(1).
		Find(&sessions).Error; err != nil {
		return SessionRef{}, err
	}
	if len(sessions) == 1 {
		return SessionRef{ID: sessions[0].ID.String(), StartedAt: sessions[0].StartedAt.UTC()}, nil
	}
	return SessionRef{ID: stamp, StartedAt: at.UTC()}, nil
}

// SessionKeyAt returns the id of the stream session owning `at`; see
// SessionAt.
func (r *ViewerFactRepository) SessionKeyAt(at time.Time, stamp string) (string, error) {
	session, err := r.SessionAt(at, stamp)
	return session.ID, err
}

// PreviousSessionID returns the latest session that started before `current`
// and was live at least once, or "" when there is none. A session that never
// went live is passed over, so an offline chat session does not break a
// viewer's streak. When `current` is not a stream_sessions row (a stamp
// fallback), `at` bounds the search instead of its start.
func (r *ViewerFactRepository) PreviousSessionID(current string, at time.Time) (string, error) {
	bound := at.UTC()
	currentID, parseErr := uuid.Parse(current)
	isRow := parseErr == nil
	if isRow {
		var starts []time.Time
		if err := r.db.Model(&models.StreamSession{}).
			Where("id = ?", currentID).
			Pluck("started_at", &starts).Error; err != nil {
			return "", err
		}
		isRow = len(starts) == 1
		if isRow {
			bound = starts[0].UTC()
		}
	}

	query := r.db.Model(&models.StreamSession{}).Where("started_at < ?", bound)
	if isRow {
		query = query.Where("id <> ?", currentID)
	}
	var ids []string
	if err := query.
		Where("EXISTS (?)", r.db.Model(&models.StreamSessionSegment{}).
			Select("1").
			Where("stream_session_segments.stream_session_id = stream_sessions.id")).
		Order("started_at DESC").
		Limit(1).
		Pluck("id", &ids).Error; err != nil {
		return "", err
	}
	if len(ids) == 1 {
		return ids[0], nil
	}
	return "", nil
}

type deltaOutcome int

const (
	deltaFolded deltaOutcome = iota
	deltaSkipped
	deltaInvalid
)

func (r *ViewerFactRepository) applyDelta(delta FactDelta, definition deltaDefinition, occurredAt time.Time, sessions *sessionResolver) (deltaOutcome, *FactChange, error) {
	needsSession := definition.windowKind == models.FactWindowSession ||
		delta.Op == models.FactAggregateSessions ||
		delta.Op == models.FactAggregateSessionStreak
	var session SessionRef
	if needsSession {
		resolved, err := sessions.currentSession()
		if err != nil {
			return deltaFolded, nil, err
		}
		if resolved.ID == "" {
			return deltaSkipped, nil, nil
		}
		session = resolved
	}
	key := models.FactValue{
		FactID:    delta.FactID,
		Platform:  delta.Platform,
		SubjectID: delta.SubjectID,
	}
	if definition.windowKind == models.FactWindowSession {
		key.WindowKey = session.ID
	}

	fold := FactFold{
		Op:               delta.Op,
		Num:              delta.Num,
		Str:              delta.Str,
		OccurredAt:       occurredAt,
		SessionID:        session.ID,
		SessionStartedAt: session.StartedAt,
	}
	// The value is read under a row lock and written in the same
	// transaction. A miss is inserted with ON CONFLICT DO NOTHING, and losing
	// that race to a concurrent first fold re-reads the winner's row, now
	// locked, and folds onto it.
	for attempt := 0; attempt < 2; attempt++ {
		before, storedName, found, err := r.lockValue(key)
		if err != nil {
			return deltaFolded, nil, err
		}
		if fold.Op == models.FactAggregateSessionStreak && fold.countsNewSession(before) && before != nil {
			previous, err := sessions.previousID()
			if err != nil {
				return deltaFolded, nil, err
			}
			fold.PreviousSessionID = previous
		}
		after, err := fold.Apply(before)
		if err != nil {
			return deltaInvalid, nil, nil
		}
		name := storedName
		if delta.SubjectName != nil {
			name = delta.SubjectName
		}

		valueChanged := !equalState(before, after)
		if found {
			if !valueChanged && equalInt(before.At, after.At) && equalStr(name, storedName) {
				return deltaFolded, nil, nil
			}
			if err := r.db.Model(&models.FactValue{}).
				Where("fact_id = ? AND platform = ? AND subject_id = ? AND window_key = ?",
					key.FactID, key.Platform, key.SubjectID, key.WindowKey).
				Updates(map[string]interface{}{
					"num_value":    after.Num,
					"str_value":    after.Str,
					"value_at_ms":  after.At,
					"subject_name": name,
					"updated_at":   time.Now().UTC(),
				}).Error; err != nil {
				return deltaFolded, nil, err
			}
		} else {
			inserted := r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(&models.FactValue{
				FactID:      key.FactID,
				Platform:    key.Platform,
				SubjectID:   key.SubjectID,
				WindowKey:   key.WindowKey,
				NumValue:    after.Num,
				StrValue:    after.Str,
				ValueAtMs:   after.At,
				SubjectName: name,
				UpdatedAt:   time.Now().UTC(),
			})
			if inserted.Error != nil {
				return deltaFolded, nil, inserted.Error
			}
			if inserted.RowsAffected == 0 {
				continue
			}
		}
		if !valueChanged {
			return deltaFolded, nil, nil
		}
		return deltaFolded, &FactChange{
			FactID:      key.FactID,
			Platform:    key.Platform,
			SubjectID:   key.SubjectID,
			WindowKey:   key.WindowKey,
			SubjectName: name,
			Before:      before,
			After:       after,
		}, nil
	}
	return deltaFolded, nil, fmt.Errorf("fact %s: value for %s/%s was created concurrently and could not be read back",
		key.FactID, key.Platform, key.SubjectID)
}

// lockValue reads the stored value under a row lock. found is false when
// there is no row yet. SQLite takes no row locks; its single writer
// serializes the transactions instead.
func (r *ViewerFactRepository) lockValue(key models.FactValue) (*FactValueState, *string, bool, error) {
	var stored []models.FactValue
	if err := r.db.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("fact_id = ? AND platform = ? AND subject_id = ? AND window_key = ?",
			key.FactID, key.Platform, key.SubjectID, key.WindowKey).
		Limit(1).
		Find(&stored).Error; err != nil {
		return nil, nil, false, err
	}
	if len(stored) == 0 {
		return nil, nil, false, nil
	}
	row := stored[0]
	return &FactValueState{Num: row.NumValue, Str: row.StrValue, At: row.ValueAtMs}, row.SubjectName, true, nil
}

// FactFold is one aggregate step: the delta's inputs, when the event
// happened, and the session ids the session aggregates compare against.
type FactFold struct {
	Op         string
	Num        *float64
	Str        *string
	OccurredAt time.Time
	// SessionID is the session the event belongs to, and SessionStartedAt
	// when it started. Required by sessions and session_streak.
	SessionID        string
	SessionStartedAt time.Time
	// PreviousSessionID is the live session before SessionID, or "". Read by
	// session_streak only when the event counts a new session.
	PreviousSessionID string
}

// countsNewSession reports whether a session aggregate would count the
// event's session: it is not the session already counted, and it did not
// start before it. An event from an earlier session arrives out of order (a
// backfill replays old events after live counting started) and is ignored.
func (f FactFold) countsNewSession(before *FactValueState) bool {
	if before == nil {
		return true
	}
	if equalStr(before.Str, &f.SessionID) {
		return false
	}
	return before.At == nil || f.SessionStartedAt.UnixMilli() >= *before.At
}

// Apply returns the value after folding into before. It never mutates before.
//
// At on the result is the event time, except for the session aggregates,
// where it is the start of the counted session. `last` and the session
// aggregates leave before as it is for an event older than it.
func (f FactFold) Apply(before *FactValueState) (*FactValueState, error) {
	eventAt := f.OccurredAt.UnixMilli()
	laterAt := eventAt
	if before != nil && before.At != nil && *before.At > laterAt {
		laterAt = *before.At
	}

	switch f.Op {
	case models.FactAggregateCount:
		return numberState(beforeNum(before)+1, laterAt), nil
	case models.FactAggregateSum:
		n, err := f.number()
		if err != nil {
			return nil, err
		}
		return numberState(beforeNum(before)+n, laterAt), nil
	case models.FactAggregateMin, models.FactAggregateMax:
		n, err := f.number()
		if err != nil {
			return nil, err
		}
		if before == nil || before.Num == nil {
			return numberState(n, laterAt), nil
		}
		if f.Op == models.FactAggregateMin {
			return numberState(math.Min(*before.Num, n), laterAt), nil
		}
		return numberState(math.Max(*before.Num, n), laterAt), nil
	case models.FactAggregateLast:
		if (f.Num == nil) == (f.Str == nil) {
			return nil, errors.New("last needs a number or a string, not both or neither")
		}
		if f.Num != nil {
			if _, err := f.number(); err != nil {
				return nil, err
			}
		}
		if before != nil && before.At != nil && eventAt < *before.At {
			return copyState(before), nil
		}
		return &FactValueState{Num: copyFloat(f.Num), Str: copyStr(f.Str), At: &eventAt}, nil
	case models.FactAggregateFirstAt, models.FactAggregateLastAt:
		at := float64(eventAt)
		if before == nil || before.Num == nil {
			return numberState(at, laterAt), nil
		}
		if f.Op == models.FactAggregateFirstAt {
			return numberState(math.Min(*before.Num, at), laterAt), nil
		}
		return numberState(math.Max(*before.Num, at), laterAt), nil
	case models.FactAggregateSessions, models.FactAggregateSessionStreak:
		if f.SessionID == "" {
			return nil, fmt.Errorf("%s needs a session", f.Op)
		}
		if !f.countsNewSession(before) {
			return copyState(before), nil
		}
		next := 1.0
		continues := f.Op == models.FactAggregateSessions ||
			(f.PreviousSessionID != "" && before != nil && equalStr(before.Str, &f.PreviousSessionID))
		if continues {
			next = beforeNum(before) + 1
		}
		session := f.SessionID
		startedAt := f.SessionStartedAt.UnixMilli()
		return &FactValueState{Num: &next, Str: &session, At: &startedAt}, nil
	default:
		return nil, fmt.Errorf("unknown aggregate %q", f.Op)
	}
}

func (f FactFold) number() (float64, error) {
	if f.Num == nil {
		return 0, fmt.Errorf("%s needs a number", f.Op)
	}
	if math.IsNaN(*f.Num) || math.IsInf(*f.Num, 0) {
		return 0, fmt.Errorf("%s needs a finite number, got %v", f.Op, *f.Num)
	}
	return *f.Num, nil
}

func beforeNum(before *FactValueState) float64 {
	if before == nil || before.Num == nil {
		return 0
	}
	return *before.Num
}

func numberState(n float64, at int64) *FactValueState {
	return &FactValueState{Num: &n, At: &at}
}

func copyState(state *FactValueState) *FactValueState {
	return &FactValueState{Num: copyFloat(state.Num), Str: copyStr(state.Str), At: copyInt(state.At)}
}

func copyFloat(v *float64) *float64 {
	if v == nil {
		return nil
	}
	c := *v
	return &c
}

func copyStr(v *string) *string {
	if v == nil {
		return nil
	}
	c := *v
	return &c
}

func copyInt(v *int64) *int64 {
	if v == nil {
		return nil
	}
	c := *v
	return &c
}

func equalStr(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

func equalFloat(a, b *float64) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

func equalInt(a, b *int64) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

func equalState(a, b *FactValueState) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return equalFloat(a.Num, b.Num) && equalStr(a.Str, b.Str)
}

// ErrFactDefinitionOwned is returned when a definition is saved under an id
// a different creator already holds.
var ErrFactDefinitionOwned = errors.New("fact definition is owned by another creator")

// FactDefinitionWrite says what UpsertDefinition did.
type FactDefinitionWrite int

const (
	// FactDefinitionUnchanged: the stored definition was identical.
	FactDefinitionUnchanged FactDefinitionWrite = iota
	// FactDefinitionCreated: there was no definition with the id.
	FactDefinitionCreated
	// FactDefinitionRenamed: only the name or description changed, so the
	// revision and values were kept.
	FactDefinitionRenamed
	// FactDefinitionRevised: what the fact computes changed, so the revision
	// was incremented and every value deleted.
	FactDefinitionRevised
)

// RecordFactDefinitionChange records a definition a write changed, as it
// stands after the write, in the write's transaction. The service uses it to
// write the outbox entry, so the change and its announcement commit or roll
// back together. Returning an error rolls the write back.
type RecordFactDefinitionChange func(tx *gorm.DB, definition *models.FactDefinition) error

func (r *ViewerFactRepository) GetDefinition(id string) (*models.FactDefinition, error) {
	var definition models.FactDefinition
	if err := r.db.Where("id = ?", id).First(&definition).Error; err != nil {
		return nil, err
	}
	return &definition, nil
}

// ListDefinitions returns every definition ordered by id.
func (r *ViewerFactRepository) ListDefinitions() ([]*models.FactDefinition, error) {
	definitions := []*models.FactDefinition{}
	err := r.db.Order("id ASC").Find(&definitions).Error
	return definitions, err
}

// UpsertDefinition stores `in` under its id and returns the stored row.
//
// A change to Definition, WindowKind or ValueKind is a new revision: the
// revision increments, counting restarts, and every value of the fact is
// deleted in the same transaction, since a value folded under the old
// definition means something else under the new one.
//
// Definitions are compared as JSON values rather than as text, since
// Postgres stores JSONB in its own key order and spacing.
//
// Fails with ErrFactDefinitionOwned when the id is held by a different
// (created_by_type, created_by_ref). record runs for every write and never
// for FactDefinitionUnchanged.
func (r *ViewerFactRepository) UpsertDefinition(in *models.FactDefinition, record RecordFactDefinitionChange) (*models.FactDefinition, FactDefinitionWrite, error) {
	stored, write, err := r.upsertDefinitionOnce(in, record)
	// Two first saves of one id both find no row; the loser's insert does
	// nothing. Its second attempt finds the winner's row and compares against
	// it like any later save.
	if errors.Is(err, errFactDefinitionCreatedConcurrently) {
		stored, write, err = r.upsertDefinitionOnce(in, record)
	}
	return stored, write, err
}

var errFactDefinitionCreatedConcurrently = errors.New("fact definition was created concurrently")

func (r *ViewerFactRepository) upsertDefinitionOnce(in *models.FactDefinition, record RecordFactDefinitionChange) (*models.FactDefinition, FactDefinitionWrite, error) {
	var stored models.FactDefinition
	write := FactDefinitionUnchanged
	err := r.db.Transaction(func(tx *gorm.DB) error {
		now := time.Now().UTC()
		var existing []models.FactDefinition
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ?", in.ID).Limit(1).Find(&existing).Error; err != nil {
			return err
		}

		if len(existing) == 0 {
			stored = *in
			stored.Revision = 1
			stored.CountingSince = now
			stored.BackfilledThrough = nil
			stored.CreatedAt = now
			stored.UpdatedAt = now
			created := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&stored)
			if created.Error != nil {
				return created.Error
			}
			if created.RowsAffected == 0 {
				return errFactDefinitionCreatedConcurrently
			}
			write = FactDefinitionCreated
			return record(tx, &stored)
		}

		stored = existing[0]
		if stored.CreatedByType != in.CreatedByType || stored.CreatedByRef != in.CreatedByRef {
			return fmt.Errorf("%w: %s is held by %s %q", ErrFactDefinitionOwned, in.ID, stored.CreatedByType, stored.CreatedByRef)
		}
		sameBody, err := sameJSON(stored.Definition, in.Definition)
		if err != nil {
			return fmt.Errorf("fact definition %s: %w", in.ID, err)
		}
		revised := !sameBody ||
			stored.AggregateFn != in.AggregateFn ||
			stored.WindowKind != in.WindowKind ||
			stored.ValueKind != in.ValueKind
		renamed := stored.Name != in.Name || stored.Description != in.Description
		if !revised && !renamed {
			return nil
		}

		stored.Name = in.Name
		stored.Description = in.Description
		stored.UpdatedAt = now
		write = FactDefinitionRenamed
		if revised {
			stored.Definition = in.Definition
			stored.AggregateFn = in.AggregateFn
			stored.WindowKind = in.WindowKind
			stored.ValueKind = in.ValueKind
			stored.Revision++
			stored.CountingSince = now
			stored.BackfilledThrough = nil
			write = FactDefinitionRevised
			if err := tx.Where("fact_id = ?", stored.ID).Delete(&models.FactValue{}).Error; err != nil {
				return err
			}
		}
		if err := tx.Model(&models.FactDefinition{}).Where("id = ?", stored.ID).Updates(map[string]interface{}{
			"name":               stored.Name,
			"description":        stored.Description,
			"definition":         stored.Definition,
			"aggregate_fn":       stored.AggregateFn,
			"window_kind":        stored.WindowKind,
			"value_kind":         stored.ValueKind,
			"revision":           stored.Revision,
			"counting_since":     stored.CountingSince,
			"backfilled_through": stored.BackfilledThrough,
			"updated_at":         stored.UpdatedAt,
		}).Error; err != nil {
			return err
		}
		return record(tx, &stored)
	})
	if err != nil {
		return nil, FactDefinitionUnchanged, err
	}
	return &stored, write, nil
}

// DeleteDefinition deletes a definition; its values go with it by cascade.
// Returns gorm.ErrRecordNotFound when there is no such definition.
func (r *ViewerFactRepository) DeleteDefinition(id string, record RecordFactDefinitionChange) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var existing models.FactDefinition
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ?", id).First(&existing).Error; err != nil {
			return err
		}
		if err := tx.Where("id = ?", id).Delete(&models.FactDefinition{}).Error; err != nil {
			return err
		}
		return record(tx, &existing)
	})
}

// ViewerFactValue is one of a viewer's values with the kinds of its fact.
type ViewerFactValue struct {
	FactID      string
	WindowKind  string
	ValueKind   string
	NumValue    *float64
	StrValue    *string
	SubjectName *string
	UpdatedAt   time.Time
}

// ViewerValues returns a viewer's lifetime values and their values in
// sessionKey, ordered by fact id. An empty sessionKey returns lifetime
// values only.
func (r *ViewerFactRepository) ViewerValues(platform, subjectID, sessionKey string) ([]ViewerFactValue, error) {
	windows := r.db.Where("fact_definitions.window_kind = ? AND fact_values.window_key = ''", models.FactWindowLifetime)
	if sessionKey != "" {
		windows = windows.Or("fact_definitions.window_kind = ? AND fact_values.window_key = ?", models.FactWindowSession, sessionKey)
	}
	values := []ViewerFactValue{}
	err := r.db.Table("fact_values").
		Select(`fact_values.fact_id, fact_definitions.window_kind, fact_definitions.value_kind,
			fact_values.num_value, fact_values.str_value, fact_values.subject_name, fact_values.updated_at`).
		Joins("JOIN fact_definitions ON fact_definitions.id = fact_values.fact_id").
		Where("fact_values.platform = ? AND fact_values.subject_id = ?", platform, subjectID).
		Where(windows).
		Order("fact_values.fact_id ASC").
		Scan(&values).Error
	return values, err
}

func sameJSON(a, b string) (bool, error) {
	var left, right any
	if err := json.Unmarshal([]byte(a), &left); err != nil {
		return false, err
	}
	if err := json.Unmarshal([]byte(b), &right); err != nil {
		return false, err
	}
	return reflect.DeepEqual(left, right), nil
}

// PruneAppliedEvents deletes the dedupe rows of events applied before
// `before`, `batchSize` rows per statement, and returns how many it deleted.
// Batches keep each statement's locks short on a table every apply writes
// to. An event redelivered after its row is pruned would be applied again, so
// `before` must be older than any redelivery.
func (r *ViewerFactRepository) PruneAppliedEvents(before time.Time, batchSize int) (int64, error) {
	if batchSize < 1 {
		return 0, fmt.Errorf("prune batch size must be at least 1, got %d", batchSize)
	}
	var total int64
	for {
		result := r.db.Exec(`DELETE FROM fact_applied_events WHERE (source, event_id) IN (
			SELECT source, event_id FROM fact_applied_events WHERE applied_at < ? LIMIT ?)`,
			before.UTC(), batchSize)
		if result.Error != nil {
			return total, result.Error
		}
		total += result.RowsAffected
		if result.RowsAffected < int64(batchSize) {
			return total, nil
		}
	}
}
