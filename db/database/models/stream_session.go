package models

import (
	"time"

	"github.com/google/uuid"
)

// StreamSession is the logical span a broadcast belongs to. It is not the same
// thing as "the stream is live": one session may cover several online/offline
// cycles, because a stream can end by accident or end briefly and still be
// continuous with what follows. The live spans are `StreamSessionSegment` rows.
//
// A session is always present for an application, and at most one is open. The
// schema enforces that with a partial unique index on `application_id WHERE
// status = 'open'` rather than leaving it to the resolver, so a concurrent
// second writer fails a write instead of corrupting the history that every
// future aggregate is computed from.
type StreamSession struct {
	ID            uuid.UUID `gorm:"type:uuid;default:uuid_generate_v4();primaryKey"`
	ApplicationID uuid.UUID `gorm:"column:application_id;type:uuid;not null;index:idx_stream_sessions_app_started_at,priority:1;constraint:OnUpdate:CASCADE,OnDelete:CASCADE"`
	Status        string    `gorm:"column:status;type:text;not null;default:'open'"`
	StartedAt     time.Time `gorm:"column:started_at;not null;index:idx_stream_sessions_app_started_at,priority:2,sort:desc"`
	// Set when a split closed this session. Nil while open; the schema keeps
	// this column and `status` from disagreeing about the same fact.
	EndedAt   *time.Time `gorm:"column:ended_at"`
	CreatedAt time.Time  `gorm:"column:created_at"`
	UpdatedAt time.Time  `gorm:"column:updated_at"`

	// Relationships
	Application Application `gorm:"foreignKey:ApplicationID;references:ID"`
}

func (StreamSession) TableName() string {
	return "stream_sessions"
}

const (
	// StreamSessionStatusOpen is the session events are currently stamped with.
	StreamSessionStatusOpen = "open"
	// StreamSessionStatusClosed is a session a later one has replaced.
	StreamSessionStatusClosed = "closed"
)

func ValidStreamSessionStatus(status string) bool {
	switch status {
	case StreamSessionStatusOpen, StreamSessionStatusClosed:
		return true
	default:
		return false
	}
}
