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
	Error string `gorm:"column:error;type:text;not null;default:''"`
	// Version counts the writes applied to the row, starting at 1 when it is
	// created. The database increments it in the same statement as each
	// write, so it orders the row's published snapshots by when the writes
	// were applied. See AlertRepository.UpdateLifecycle.
	Version   int64     `gorm:"column:version;not null;default:1"`
	CreatedAt time.Time `gorm:"column:created_at;index:idx_alerts_created_at,sort:desc"`
	UpdatedAt time.Time
}

func (Alert) TableName() string {
	return "alerts"
}
