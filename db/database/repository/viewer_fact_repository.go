package repository

import (
	"errors"
	"fmt"
	"math"
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
// the aggregate reads: Num for sum, min and max, either for last, neither for
// the rest.
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
// does not exist yet.
type FactValueState struct {
	Num *float64
	Str *string
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
// Dropped counts deltas computed against a revision that is no longer
// current, or against a definition that no longer exists.
type FactApplyResult struct {
	Applied bool
	Changes []FactChange
	Dropped int
}

// Apply folds a batch into fact_values in one transaction.
//
// The dedupe row is the first write, so a redelivered event is refused before
// anything else is read. Each value is created if absent and then locked
// before it is read, so two batches touching one value serialize on it rather
// than one overwriting the other's fold.
//
// A delta whose window or aggregate needs a stream session is skipped when
// none can be resolved, which happens only before the first session exists.
func (r *ViewerFactRepository) Apply(batch FactBatch) (*FactApplyResult, error) {
	if batch.OccurredAt.IsZero() {
		return nil, errors.New("fact batch: occurred_at is required")
	}
	if !batch.SkipDedupe && (batch.Source == "" || batch.EventID == "") {
		return nil, errors.New("fact batch: source and event_id are required")
	}

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

		definitions, err := txRepo.definitionsFor(batch.Deltas)
		if err != nil {
			return err
		}
		sessions := &sessionResolver{repo: txRepo, occurredAt: batch.OccurredAt, stamp: batch.SessionStamp}
		for _, delta := range batch.Deltas {
			definition, ok := definitions[delta.FactID]
			if !ok || definition.revision != delta.Revision {
				result.Dropped++
				continue
			}
			if delta.Op != definition.fn {
				return fmt.Errorf("fact %s revision %d: delta op %q, definition folds with %q",
					delta.FactID, delta.Revision, delta.Op, definition.fn)
			}
			change, err := txRepo.applyDelta(delta, definition.windowKind, batch.OccurredAt, sessions)
			if err != nil {
				return err
			}
			if change != nil {
				result.Changes = append(result.Changes, *change)
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return result, nil
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
	fn         string
}

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
	if err := r.db.Where("id IN ?", ids).Find(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		body, err := row.Body()
		if err != nil {
			return nil, err
		}
		found[row.ID] = deltaDefinition{revision: row.Revision, windowKind: row.WindowKind, fn: body.Aggregate.Fn}
	}
	return found, nil
}

// sessionResolver looks the batch's sessions up at most once each, since
// every delta of a batch shares one occurred_at.
type sessionResolver struct {
	repo       *ViewerFactRepository
	occurredAt time.Time
	stamp      string

	current         *string
	previous        *string
	previousCurrent string
}

func (s *sessionResolver) currentID() (string, error) {
	if s.current == nil {
		id, err := s.repo.SessionKeyAt(s.occurredAt, s.stamp)
		if err != nil {
			return "", err
		}
		s.current = &id
	}
	return *s.current, nil
}

func (s *sessionResolver) previousID(current string) (string, error) {
	if s.previous == nil || s.previousCurrent != current {
		id, err := s.repo.PreviousSessionID(current, s.occurredAt)
		if err != nil {
			return "", err
		}
		s.previous = &id
		s.previousCurrent = current
	}
	return *s.previous, nil
}

// SessionKeyAt returns the id of the stream session owning `at`: the one with
// the latest started_at at or before it. A session owns everything from its
// start to the next session's start, which is what a split preserves. Falls
// back to stamp when no session started by then, and returns "" when that is
// empty too.
func (r *ViewerFactRepository) SessionKeyAt(at time.Time, stamp string) (string, error) {
	var ids []string
	if err := r.db.Model(&models.StreamSession{}).
		Where("started_at <= ?", at.UTC()).
		Order("started_at DESC").
		Limit(1).
		Pluck("id", &ids).Error; err != nil {
		return "", err
	}
	if len(ids) == 1 {
		return ids[0], nil
	}
	return stamp, nil
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

func (r *ViewerFactRepository) applyDelta(delta FactDelta, windowKind string, occurredAt time.Time, sessions *sessionResolver) (*FactChange, error) {
	needsSession := windowKind == models.FactWindowSession ||
		delta.Op == models.FactAggregateSessions ||
		delta.Op == models.FactAggregateSessionStreak
	sessionID := ""
	if needsSession {
		id, err := sessions.currentID()
		if err != nil {
			return nil, err
		}
		if id == "" {
			return nil, nil
		}
		sessionID = id
	}
	windowKey := ""
	if windowKind == models.FactWindowSession {
		windowKey = sessionID
	}

	key := models.FactValue{
		FactID:    delta.FactID,
		Platform:  delta.Platform,
		SubjectID: delta.SubjectID,
		WindowKey: windowKey,
	}
	before, storedName, err := r.lockValue(key, delta.SubjectName)
	if err != nil {
		return nil, err
	}

	fold := FactFold{Op: delta.Op, Num: delta.Num, Str: delta.Str, OccurredAt: occurredAt, SessionID: sessionID}
	if delta.Op == models.FactAggregateSessionStreak && before != nil && !equalStr(before.Str, &sessionID) {
		previous, err := sessions.previousID(sessionID)
		if err != nil {
			return nil, err
		}
		fold.PreviousSessionID = previous
	}
	after, err := fold.Apply(before)
	if err != nil {
		return nil, fmt.Errorf("fact %s: %w", delta.FactID, err)
	}

	name := storedName
	if delta.SubjectName != nil {
		name = delta.SubjectName
	}
	valueChanged := !equalState(before, after)
	if !valueChanged && equalStr(name, storedName) {
		return nil, nil
	}
	if err := r.db.Model(&models.FactValue{}).
		Where("fact_id = ? AND platform = ? AND subject_id = ? AND window_key = ?",
			key.FactID, key.Platform, key.SubjectID, key.WindowKey).
		Updates(map[string]interface{}{
			"num_value":    after.Num,
			"str_value":    after.Str,
			"subject_name": name,
			"updated_at":   time.Now().UTC(),
		}).Error; err != nil {
		return nil, err
	}
	if !valueChanged {
		return nil, nil
	}
	return &FactChange{
		FactID:      key.FactID,
		Platform:    key.Platform,
		SubjectID:   key.SubjectID,
		WindowKey:   key.WindowKey,
		SubjectName: name,
		Before:      before,
		After:       after,
	}, nil
}

// lockValue returns the stored value under a row lock, creating the row when
// absent so there is a row to lock. A created row reads as a nil state: its
// value does not exist until the caller's fold writes one in the same
// transaction. SQLite takes no row locks; its single writer serializes the
// transactions instead.
func (r *ViewerFactRepository) lockValue(key models.FactValue, name *string) (*FactValueState, *string, error) {
	created := r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(&models.FactValue{
		FactID:      key.FactID,
		Platform:    key.Platform,
		SubjectID:   key.SubjectID,
		WindowKey:   key.WindowKey,
		SubjectName: name,
		UpdatedAt:   time.Now().UTC(),
	})
	if created.Error != nil {
		return nil, nil, created.Error
	}
	if created.RowsAffected == 1 {
		return nil, name, nil
	}

	var stored models.FactValue
	if err := r.db.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("fact_id = ? AND platform = ? AND subject_id = ? AND window_key = ?",
			key.FactID, key.Platform, key.SubjectID, key.WindowKey).
		First(&stored).Error; err != nil {
		return nil, nil, err
	}
	return &FactValueState{Num: stored.NumValue, Str: stored.StrValue}, stored.SubjectName, nil
}

// FactFold is one aggregate step: the delta's inputs, and the session ids the
// session aggregates compare against.
type FactFold struct {
	Op         string
	Num        *float64
	Str        *string
	OccurredAt time.Time
	// SessionID is the session the event belongs to. Required by sessions
	// and session_streak.
	SessionID string
	// PreviousSessionID is the live session before SessionID, or "". Read by
	// session_streak only when the stored value counted a different session.
	PreviousSessionID string
}

// Apply returns the value after folding into before. It never mutates before.
func (f FactFold) Apply(before *FactValueState) (*FactValueState, error) {
	switch f.Op {
	case models.FactAggregateCount:
		return numberState(beforeNum(before) + 1), nil
	case models.FactAggregateSum:
		n, err := f.number()
		if err != nil {
			return nil, err
		}
		return numberState(beforeNum(before) + n), nil
	case models.FactAggregateMin, models.FactAggregateMax:
		n, err := f.number()
		if err != nil {
			return nil, err
		}
		if before == nil || before.Num == nil {
			return numberState(n), nil
		}
		if f.Op == models.FactAggregateMin {
			return numberState(math.Min(*before.Num, n)), nil
		}
		return numberState(math.Max(*before.Num, n)), nil
	case models.FactAggregateLast:
		if f.Num == nil && f.Str == nil {
			return nil, errors.New("last needs a number or a string")
		}
		return &FactValueState{Num: copyFloat(f.Num), Str: copyStr(f.Str)}, nil
	case models.FactAggregateFirstAt, models.FactAggregateLastAt:
		at := float64(f.OccurredAt.UnixMilli())
		if before == nil || before.Num == nil {
			return numberState(at), nil
		}
		if f.Op == models.FactAggregateFirstAt {
			return numberState(math.Min(*before.Num, at)), nil
		}
		return numberState(math.Max(*before.Num, at)), nil
	case models.FactAggregateSessions, models.FactAggregateSessionStreak:
		if f.SessionID == "" {
			return nil, fmt.Errorf("%s needs a session", f.Op)
		}
		if before != nil && equalStr(before.Str, &f.SessionID) {
			return &FactValueState{Num: copyFloat(before.Num), Str: copyStr(before.Str)}, nil
		}
		next := 1.0
		continues := f.Op == models.FactAggregateSessions ||
			(f.PreviousSessionID != "" && before != nil && equalStr(before.Str, &f.PreviousSessionID))
		if continues {
			next = beforeNum(before) + 1
		}
		session := f.SessionID
		return &FactValueState{Num: &next, Str: &session}, nil
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

func numberState(n float64) *FactValueState {
	return &FactValueState{Num: &n}
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

func equalState(a, b *FactValueState) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return equalFloat(a.Num, b.Num) && equalStr(a.Str, b.Str)
}
