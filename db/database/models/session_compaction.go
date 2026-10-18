package models

import (
	"time"

	"github.com/google/uuid"
)

// StreamSessionCompaction records that a closed session's analytics were
// copied out of user_events, and the span of time the copy covers: the
// session's bounds when it was compacted. Raw events inside the window are
// read from the copy, so they can be pruned without changing a read.
type StreamSessionCompaction struct {
	SessionID       uuid.UUID `gorm:"column:session_id;type:uuid;primaryKey"`
	WindowStartedAt time.Time `gorm:"column:window_started_at;not null"`
	WindowEndedAt   time.Time `gorm:"column:window_ended_at;not null"`
	// CompactedAt is the db proxy's clock, which also stamps
	// user_events.created_at: a raw row of the window created after it was
	// recorded after the copy was made.
	CompactedAt time.Time `gorm:"column:compacted_at;not null"`
	// PrunedAt is set when the cleaner began deleting the window's raw rows.
	// The copy is then the only record of the session, so it is never
	// rebuilt from the raw log again.
	PrunedAt *time.Time `gorm:"column:pruned_at"`
}

func (StreamSessionCompaction) TableName() string {
	return "stream_session_compactions"
}

// Covers reports whether the copy describes the session as it stands: a
// closed session whose bounds are the ones that were compacted.
func (c *StreamSessionCompaction) Covers(session *StreamSession) bool {
	return session.Status == StreamSessionStatusClosed &&
		session.EndedAt != nil &&
		c.WindowStartedAt.Equal(session.StartedAt) &&
		c.WindowEndedAt.Equal(*session.EndedAt)
}

// SessionTimelineEvent is one event of a compacted session's timeline: a
// user_events row the session timeline lists, without its payload.
type SessionTimelineEvent struct {
	SessionID        uuid.UUID `gorm:"column:session_id;type:uuid;primaryKey"`
	UserEventID      uuid.UUID `gorm:"column:user_event_id;type:uuid;primaryKey"`
	EventID          string    `gorm:"column:event_id"`
	Source           string    `gorm:"column:source"`
	EventType        string    `gorm:"column:event_type"`
	Platform         string    `gorm:"column:platform"`
	PlatformUserID   *string   `gorm:"column:platform_user_id"`
	UserName         *string   `gorm:"column:user_name"`
	StampedSessionID *string   `gorm:"column:stamped_session_id"`
	Amount           *int64    `gorm:"column:amount"`
	OccurredAt       time.Time `gorm:"column:occurred_at"`
	RecordedAt       time.Time `gorm:"column:recorded_at"`
}

func (SessionTimelineEvent) TableName() string {
	return "session_timeline_events"
}

// AsUserEvent is the raw row this event was copied from, with an empty
// payload.
func (e *SessionTimelineEvent) AsUserEvent() *UserEvent {
	return &UserEvent{
		ID:             e.UserEventID,
		EventID:        e.EventID,
		Source:         e.Source,
		EventType:      e.EventType,
		Platform:       e.Platform,
		PlatformUserID: e.PlatformUserID,
		UserName:       e.UserName,
		SessionID:      e.StampedSessionID,
		Amount:         e.Amount,
		EventValue:     "{}",
		OccurredAt:     e.OccurredAt,
		CreatedAt:      e.RecordedAt,
	}
}
