package repository

import (
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
)

// StreamSessionRepository wraps gorm.DB with stream-session helpers.
//
// It covers both `stream_sessions` and `stream_session_segments` rather than
// splitting them, because a segment has no lifecycle of its own: it is only
// ever reached through its session, and the resolver's central read spans both
// tables and must see them consistently.
type StreamSessionRepository struct {
	db *gorm.DB
}

func NewStreamSessionRepository(db *gorm.DB) *StreamSessionRepository {
	return &StreamSessionRepository{db: db}
}

// EnsureOpenSession returns the open session, creating one at
// `startedAt` when none is open. The bool reports whether a session was
// created, which is what tells the caller whether to emit a lifecycle event.
//
// Runs in a transaction because "look for an open session, create one if
// absent" is a read-then-write that two engines can execute concurrently. The
// partial unique index is the backstop; the transaction is what keeps the
// common case from relying on it.
func (r *StreamSessionRepository) EnsureOpenSession(startedAt time.Time) (*models.StreamSession, bool, error) {
	var session models.StreamSession
	created := false
	err := r.db.Transaction(func(tx *gorm.DB) error {
		err := tx.Where("status = ?", models.StreamSessionStatusOpen).
			First(&session).Error
		if err == nil {
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		session = models.StreamSession{
			ID:        uuid.New(),
			Status:    models.StreamSessionStatusOpen,
			StartedAt: startedAt,
		}
		if createErr := tx.Create(&session).Error; createErr != nil {
			return createErr
		}
		created = true
		return nil
	})
	if err != nil {
		return nil, false, err
	}
	return &session, created, nil
}

// SplitSession ends the open session at `at` and opens its successor starting
// at the same instant, returning both.
//
// One transaction, and the close happens before the insert: the partial unique
// index permits only one open session, so the opposite order
// would reject its own write. Doing this as two calls would also leave a window
// with no open session, which is the one state the design says cannot exist.
//
// Returns gorm.ErrRecordNotFound when no session is open.
func (r *StreamSessionRepository) SplitSession(at time.Time) (*models.StreamSession, *models.StreamSession, error) {
	var ended models.StreamSession
	var started models.StreamSession

	err := r.db.Transaction(func(tx *gorm.DB) error {
		var current models.StreamSession
		if err := tx.Where("status = ?", models.StreamSessionStatusOpen).
			First(&current).Error; err != nil {
			return err
		}

		res := tx.Model(&models.StreamSession{}).
			Where("id = ? AND status = ?", current.ID, models.StreamSessionStatusOpen).
			Updates(map[string]interface{}{
				"status":     models.StreamSessionStatusClosed,
				"ended_at":   at,
				"updated_at": time.Now().UTC(),
			})
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		if err := tx.Where("id = ?", current.ID).First(&ended).Error; err != nil {
			return err
		}

		started = models.StreamSession{
			ID:        uuid.New(),
			Status:    models.StreamSessionStatusOpen,
			StartedAt: at,
		}
		return tx.Create(&started).Error
	})
	if err != nil {
		return nil, nil, err
	}
	return &ended, &started, nil
}

// GetOpenSession returns the open session, or
// gorm.ErrRecordNotFound when none is open.
func (r *StreamSessionRepository) GetOpenSession() (*models.StreamSession, error) {
	var session models.StreamSession
	err := r.db.
		Where("status = ?", models.StreamSessionStatusOpen).
		First(&session).Error
	return &session, err
}

func (r *StreamSessionRepository) GetSessionByID(id uuid.UUID) (*models.StreamSession, error) {
	var session models.StreamSession
	err := r.db.Where("id = ?", id).First(&session).Error
	return &session, err
}

// ListSessions returns sessions newest-first, backed by
// `idx_stream_sessions_started_at`. `limit <= 0` means no limit.
func (r *StreamSessionRepository) ListSessions(limit, offset int) ([]*models.StreamSession, error) {
	var sessions []*models.StreamSession
	q := r.db.Order("started_at DESC")
	if limit > 0 {
		q = q.Limit(limit).Offset(offset)
	}
	err := q.Find(&sessions).Error
	return sessions, err
}

func (r *StreamSessionRepository) CountSessions() (int64, error) {
	var n int64
	err := r.db.Model(&models.StreamSession{}).Count(&n).Error
	return n, err
}

// GetOpenSegment returns the open segment (the stream is live),
// or gorm.ErrRecordNotFound when it is not.
func (r *StreamSessionRepository) GetOpenSegment() (*models.StreamSessionSegment, error) {
	var segment models.StreamSessionSegment
	err := r.db.
		Where("ended_at IS NULL").
		First(&segment).Error
	return &segment, err
}

// LastEndedSegment returns the session's most recently ended segment, which is
// the "when did the stream last go down" input to the extend-or-split
// decision. Returns gorm.ErrRecordNotFound when the session has never been
// live -- a distinct case the caller must not collapse into a zero time.
func (r *StreamSessionRepository) LastEndedSegment(streamSessionID uuid.UUID) (*models.StreamSessionSegment, error) {
	var segment models.StreamSessionSegment
	err := r.db.
		Where("stream_session_id = ? AND ended_at IS NOT NULL", streamSessionID).
		Order("ended_at DESC").
		First(&segment).Error
	return &segment, err
}

// OpenSegment starts a live span within a session.
//
// Returns the already-open segment unchanged when one exists rather than
// inserting a second: Twitch redelivers `stream.online` notifications, and two
// open segments would give "when did the stream last go down" two answers.
func (r *StreamSessionRepository) OpenSegment(streamSessionID uuid.UUID, startedAt time.Time) (*models.StreamSessionSegment, error) {
	var segment models.StreamSessionSegment
	err := r.db.Transaction(func(tx *gorm.DB) error {
		err := tx.Where("ended_at IS NULL").First(&segment).Error
		if err == nil {
			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		segment = models.StreamSessionSegment{
			ID:              uuid.New(),
			StreamSessionID: streamSessionID,
			StartedAt:       startedAt,
		}
		return tx.Create(&segment).Error
	})
	if err != nil {
		return nil, err
	}
	return &segment, nil
}

// CloseOpenSegment ends whichever segment is open.
//
// Not keyed on a segment id because the caller reacting to `stream.offline`
// knows the stream went down, not which segment it opened.
// Returns gorm.ErrRecordNotFound when no segment is open, which is the normal
// result of a duplicate `stream.offline`.
func (r *StreamSessionRepository) CloseOpenSegment(endedAt time.Time) (*models.StreamSessionSegment, error) {
	var segment models.StreamSessionSegment
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var open models.StreamSessionSegment
		if err := tx.Where("ended_at IS NULL").
			First(&open).Error; err != nil {
			return err
		}
		res := tx.Model(&models.StreamSessionSegment{}).
			Where("id = ? AND ended_at IS NULL", open.ID).
			Updates(map[string]interface{}{
				"ended_at":   endedAt,
				"updated_at": time.Now().UTC(),
			})
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		return tx.Where("id = ?", open.ID).First(&segment).Error
	})
	if err != nil {
		return nil, err
	}
	return &segment, nil
}
