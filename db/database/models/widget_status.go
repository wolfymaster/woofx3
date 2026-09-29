package models

import (
	"time"

	"github.com/google/uuid"
)

// WidgetStatus is one (latest) value reported via
// `widgetHost.reportStatus(key, value)` from a widget instance
// running inside a scene overlay (Phase 4 of the widget-completion
// plan).
//
// Keyed by `(InstanceID, Key)` — every report for the
// same pair replaces in place. History is intentionally not kept on
// this table; if audit timelines become a need later, add an
// append-only `widget_status_log` separately.
//
// `Value` is opaque JSONB. The engine never inspects it; downstream
// consumers (dashboard, future workflow triggers reading
// `widget_status:foo`) parse based on widget-defined schema.
//
// `ModuleID` and `WidgetCanonicalID` are denormalised from
// `WidgetInstance.moduleId` and the canonical widget id so consumers
// can group rows by widget definition without joining through the
// `scenes.widgets_json` blob.
type WidgetStatus struct {
	ID                uuid.UUID `gorm:"type:uuid;default:uuid_generate_v4();primaryKey"`
	ModuleID          string    `gorm:"column:module_id;type:text;not null;default:'';index:idx_widget_status_module"`
	InstanceID        string    `gorm:"column:instance_id;type:text;not null;uniqueIndex:widget_status_unique,priority:1"`
	WidgetCanonicalID string    `gorm:"column:widget_canonical_id;type:text;not null;default:''"`
	Key               string    `gorm:"column:key;type:text;not null;uniqueIndex:widget_status_unique,priority:2"`
	// Value carries arbitrary JSON. Stored as a string so the layer
	// below the proto never re-marshals — the api / db service
	// round-trip the bytes verbatim.
	Value      string    `gorm:"column:value;type:jsonb;not null"`
	OccurredAt time.Time `gorm:"column:occurred_at;not null"`
	CreatedAt  time.Time `gorm:"column:created_at"`
	UpdatedAt  time.Time
}

func (WidgetStatus) TableName() string {
	return "widget_status"
}
