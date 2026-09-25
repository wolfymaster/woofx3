package models

import (
	"time"

	"github.com/google/uuid"
)

// StreamSessionSegment is one online span within a session: the stream went
// live at `StartedAt` and went down at `EndedAt`.
//
// Offline is the gap between segments rather than a segment of its own, which
// is what makes a session with no segments precisely "a session that has never
// been live" — a state the extend-or-split policy treats differently from
// "went offline a long time ago".
//
// Segments are the unit a retroactive split moves between sessions. Events are
// never rewritten, so the session id stamped on an event identifies whichever
// session owned its segment at the time of stamping.
type StreamSessionSegment struct {
	ID              uuid.UUID `gorm:"type:uuid;default:uuid_generate_v4();primaryKey"`
	StreamSessionID uuid.UUID `gorm:"column:stream_session_id;type:uuid;not null;index:idx_stream_session_segments_session_started_at,priority:1;constraint:OnUpdate:CASCADE,OnDelete:CASCADE"`
	StartedAt       time.Time `gorm:"column:started_at;not null;index:idx_stream_session_segments_session_started_at,priority:2,sort:desc"`
	// Nil while the stream is live. At most one segment may be open,
	// enforced by a partial unique index over rows `WHERE ended_at IS NULL`:
	// a redelivered `stream.online` must not leave two open, or "when did the
	// stream last go down" has two answers.
	EndedAt   *time.Time `gorm:"column:ended_at"`
	CreatedAt time.Time  `gorm:"column:created_at"`
	UpdatedAt time.Time  `gorm:"column:updated_at"`

	// Relationships
	StreamSession StreamSession `gorm:"foreignKey:StreamSessionID;references:ID"`
}

func (StreamSessionSegment) TableName() string {
	return "stream_session_segments"
}
