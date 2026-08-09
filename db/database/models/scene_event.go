package models

import (
	"time"

	"github.com/google/uuid"
)

// SceneEvent is the append-only parent row for one engine-triggered
// scene event — sceneManager's durable, at-least-once delivery pipeline
// (see `scene_event.proto` for the full design note). `Value` carries
// the full payload verbatim so a historical event can be replayed.
type SceneEvent struct {
	ID            uuid.UUID `gorm:"type:uuid;default:uuid_generate_v4();primaryKey"`
	SceneID       uuid.UUID `gorm:"column:scene_id;type:uuid;not null;index:idx_scene_events_scene_occurred,priority:1;constraint:OnUpdate:CASCADE,OnDelete:CASCADE"`
	ApplicationID uuid.UUID `gorm:"column:application_id;type:uuid;not null;constraint:OnUpdate:CASCADE,OnDelete:CASCADE"`
	Type          string    `gorm:"column:type;type:text;not null"`
	Key           string    `gorm:"column:key;type:text;not null"`
	// Value carries arbitrary JSON. Stored as a string, same convention
	// as `WidgetStatus.Value` — the layer below the proto never
	// re-marshals it.
	Value      string    `gorm:"column:value;type:jsonb;not null;default:'{}'"`
	OccurredAt time.Time `gorm:"column:occurred_at;not null;index:idx_scene_events_scene_occurred,priority:2"`
	CreatedAt  time.Time `gorm:"column:created_at"`
	Scene      Scene     `gorm:"foreignKey:SceneID;references:ID"`
}

func (SceneEvent) TableName() string {
	return "scene_events"
}

// SceneEventLogEntry is one append-only timeline row: a single state
// transition ("delivered" | "completed" | "failed") for one
// `(SceneEventID, InstanceID)` pair. Never updated after insert — a
// second transition for the same pair is a second row, not an update
// to the first.
type SceneEventLogEntry struct {
	ID           uuid.UUID `gorm:"type:uuid;default:uuid_generate_v4();primaryKey"`
	SceneEventID uuid.UUID `gorm:"column:scene_event_id;type:uuid;not null;index:idx_scene_event_log_scene_event;constraint:OnUpdate:CASCADE,OnDelete:CASCADE"`
	SceneID      uuid.UUID `gorm:"column:scene_id;type:uuid;not null;index:idx_scene_event_log_scene_occurred,priority:1;constraint:OnUpdate:CASCADE,OnDelete:CASCADE"`
	InstanceID   string    `gorm:"column:instance_id;type:text;not null"`
	Kind         string    `gorm:"column:kind;type:text;not null"`
	OccurredAt   time.Time `gorm:"column:occurred_at;not null;index:idx_scene_event_log_scene_occurred,priority:2"`
	CreatedAt    time.Time `gorm:"column:created_at"`
}

func (SceneEventLogEntry) TableName() string {
	return "scene_event_log"
}

// SceneEventDelivery is the mutable working-set row for one open
// fan-out target. Created alongside the parent `SceneEvent` (so the
// full target set is durable before any ack arrives), updated in
// place on each ack, and deleted once `CompletedAt` is set — the
// table only ever holds open deliveries, which is what makes a full
// scan of it "every currently-unconfirmed delivery."
type SceneEventDelivery struct {
	SceneEventID  uuid.UUID  `gorm:"column:scene_event_id;type:uuid;primaryKey;constraint:OnUpdate:CASCADE,OnDelete:CASCADE"`
	SceneID       uuid.UUID  `gorm:"column:scene_id;type:uuid;not null;index:idx_scene_event_deliveries_scene;constraint:OnUpdate:CASCADE,OnDelete:CASCADE"`
	InstanceID    string     `gorm:"column:instance_id;type:text;primaryKey"`
	DeliveredAt   *time.Time `gorm:"column:delivered_at"`
	CompletedAt   *time.Time `gorm:"column:completed_at"`
	LastAttemptAt time.Time  `gorm:"column:last_attempt_at;not null"`
	CreatedAt     time.Time  `gorm:"column:created_at"`
}

func (SceneEventDelivery) TableName() string {
	return "scene_event_deliveries"
}
