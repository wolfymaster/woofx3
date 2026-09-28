package models

import (
	"time"

	"github.com/google/uuid"
)

// UserEvent is one platform event a viewer caused: a cheer, a follow, a sub, a
// raid. The table is an append-only fact log. Rows are never updated, so any
// total derived from it can be recomputed, which is what a counter cannot do
// (docs/services/analytics.md).
//
// The viewer is identified by the platform's own id rather than a `users`
// row, so recording a fact never has to create a user first. A nil
// PlatformUserID means the event is not attributable to anyone, which is how
// anonymous cheers and gifts are kept off per-viewer totals.
type UserEvent struct {
	ID uuid.UUID `gorm:"type:uuid;primaryKey"`
	// EventID and Source are the CloudEvent's identity; together they are
	// unique, so a redelivered event cannot become a second row.
	EventID        string  `gorm:"column:event_id;type:varchar(255);not null;uniqueIndex:uq_user_events_source_event_id,priority:2"`
	Source         string  `gorm:"column:source;type:varchar(255);not null;uniqueIndex:uq_user_events_source_event_id,priority:1"`
	EventType      string  `gorm:"column:event_type;type:varchar(100);not null"`
	Platform       string  `gorm:"column:platform;type:varchar(50);not null"`
	PlatformUserID *string `gorm:"column:platform_user_id;type:varchar(100)"`
	UserName       *string `gorm:"column:user_name;type:varchar(100)"`
	// SessionID is the stream session the event was stamped with. It is not a
	// stable key: a later split can move the segment it fell in to another
	// session, so readers resolve it through the session record.
	SessionID *string `gorm:"column:session_id;type:varchar(100)"`
	// Amount is the quantity the event carries (bits, gifted subs, raiders),
	// nil when it carries none.
	Amount *int64 `gorm:"column:amount"`
	// EventValue is the CloudEvent's data as JSON, kept whole so a field no
	// column promotes today can still be read later.
	EventValue string    `gorm:"column:event_value;type:jsonb;not null"`
	OccurredAt time.Time `gorm:"column:occurred_at;not null"`
	CreatedAt  time.Time `gorm:"column:created_at;not null"`
}

func (UserEvent) TableName() string {
	return "user_events"
}

// The CloudEvent types the aggregate reads count. They must match `EventType`
// in shared/common/typescript/cloudevents/Twitch/events.ts, which is what the
// recorder stores as event_type.
const (
	UserEventTypeCheer            = "channel.cheer"
	UserEventTypeFollow           = "channel.follow"
	UserEventTypeRaid             = "channel.raid"
	UserEventTypeSubscribe        = "channel.subscribe"
	UserEventTypeSubscriptionGift = "channel.subscriptionGift"
	UserEventTypeResub            = "channel.resub"
)
