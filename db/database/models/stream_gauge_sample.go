package models

import (
	"time"

	"github.com/google/uuid"
)

// StreamGaugeSample is one minute of the levels a broadcast has -- viewer
// count, follower total, subscriber total, sub points -- read from Helix while
// the stream is live (docs/services/analytics.md).
//
// These are gauges, not sums, so they are sampled rather than derived from
// user_events: Twitch sends no unfollow and no viewer count, and its totals
// account for refunds and expirations a local sum cannot.
//
// A row exists only for a minute that was sampled, so a gap reads as "not
// sampled" rather than zero. Each metric is nil when its own read failed.
type StreamGaugeSample struct {
	ID uuid.UUID `gorm:"type:uuid;primaryKey"`
	// SegmentID is the live span the sample was taken in. It is the stable key:
	// a split moves segments between sessions, and readers resolve a session's
	// samples through the segments it owns.
	SegmentID uuid.UUID `gorm:"column:segment_id;type:uuid;not null;uniqueIndex:uq_stream_gauge_samples_segment_minute,priority:1"`
	// SessionID is the session that owned the segment when the sample was
	// recorded. Informational, like user_events.session_id.
	SessionID uuid.UUID `gorm:"column:session_id;type:uuid;not null"`
	// SampledAt is the minute the sample stands for, truncated to the minute
	// in UTC, and unique within a segment.
	SampledAt        time.Time `gorm:"column:sampled_at;not null;uniqueIndex:uq_stream_gauge_samples_segment_minute,priority:2"`
	ViewerCount      *int64    `gorm:"column:viewer_count"`
	FollowerTotal    *int64    `gorm:"column:follower_total"`
	SubscriberTotal  *int64    `gorm:"column:subscriber_total"`
	SubscriberPoints *int64    `gorm:"column:subscriber_points"`
	CreatedAt        time.Time `gorm:"column:created_at;not null"`
}

func (StreamGaugeSample) TableName() string {
	return "stream_gauge_samples"
}
