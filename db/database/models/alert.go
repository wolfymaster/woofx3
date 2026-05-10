package models

import (
	"time"

	"github.com/google/uuid"
)

// Alert is one row in the engine's append-only log of dispatched
// alert envelopes (`ui.notify.alert` NATS publishes). Mirrors the
// `Scene` and `WorkflowDefinition` shape: typed audit columns + an
// opaque JSONB `payload` the engine never inspects.
//
// `Payload` is the full AlertPayload envelope JSON
// (`{ id, parameters, event }`) — same bytes streamware broadcasts
// to overlay clients. Replay re-publishes this verbatim so the
// downstream renderer treats it identically to the original
// dispatch.
//
// `WorkflowID` and `SourceEventID` are best-effort attribution. The
// workflow `alert` action knows its execution id; manual / debug
// triggers don't, and replay re-uses the original row's attribution.
type Alert struct {
	ID            uuid.UUID  `gorm:"type:uuid;default:uuid_generate_v4();primaryKey"`
	ApplicationID uuid.UUID  `gorm:"column:application_id;type:uuid;not null;index:idx_alerts_application_created_at,priority:1;constraint:OnUpdate:CASCADE,OnDelete:CASCADE"`
	Payload       string     `gorm:"column:payload;type:jsonb;not null"`
	WorkflowID    *uuid.UUID `gorm:"column:workflow_id;type:uuid"`
	SourceEventID string     `gorm:"column:source_event_id;type:text;not null;default:''"`
	Status        string     `gorm:"column:status;type:varchar(32);not null;default:'sent'"`
	// EnvelopeID is the AlertPayload envelope id (`payload->>'id'`).
	// Denormalised so the api can fast-update the row by id when the
	// overlay reports `playing` / `completed` / `failed` over the new
	// `ui.widget.status` channel. Empty for legacy / manual rows.
	EnvelopeID   string     `gorm:"column:envelope_id;type:text;not null;default:''"`
	DispatchedAt *time.Time `gorm:"column:dispatched_at"`
	PlayedAt     *time.Time `gorm:"column:played_at"`
	CompletedAt  *time.Time `gorm:"column:completed_at"`
	// Error captures the failure reason from a `failed` overlay ack
	// (autoplay block, missing media, etc.). Empty string = "no error",
	// matching the source_event_id convention.
	Error     string    `gorm:"column:error;type:text;not null;default:''"`
	CreatedAt time.Time `gorm:"column:created_at;index:idx_alerts_application_created_at,priority:2,sort:desc"`
	UpdatedAt time.Time

	// Relationships
	Application Application `gorm:"foreignKey:ApplicationID;references:ID"`
}

func (Alert) TableName() string {
	return "alerts"
}
