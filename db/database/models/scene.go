package models

import (
	"github.com/google/uuid"
)

// Scene is the engine's per-application widget arrangement. Mirrors
// `WorkflowDefinition` in spirit: typed audit columns with two opaque
// JSONB blobs (`widgets_json`, `layout_json`) the engine never inspects.
//
// The streamware overlay (and the Convex scene editor when present)
// reads this row to compose the final browser-source render. The
// engine's only job here is durable storage + delivery; presentation
// semantics live entirely in the consumer.
type Scene struct {
	ID            uuid.UUID `gorm:"type:uuid;default:uuid_generate_v4();primaryKey"`
	ApplicationID uuid.UUID `gorm:"column:application_id;type:uuid;not null;index:idx_scenes_application_id;uniqueIndex:idx_scenes_application_name,priority:1;constraint:OnUpdate:CASCADE,OnDelete:CASCADE"`
	Name          string    `gorm:"type:varchar(255);not null;uniqueIndex:idx_scenes_application_name,priority:2"`
	Description   string    `gorm:"type:text;not null;default:''"`
	// Array of placed widget instances. Shape:
	// `[{ id, widgetCanonicalId, position: { x, y, width, height },
	//    settings: { ... per-widget overrides ... } }, ... ]`.
	// Stored as a JSON string at the proto boundary; the column itself
	// is JSONB so Postgres validates well-formedness on write.
	WidgetsJSON string `gorm:"column:widgets_json;type:jsonb;not null;default:'[]'"`
	// Canvas-level layout config. Optional; most scenes leave this
	// `{}`. The shape is editor-defined and opaque to the engine.
	LayoutJSON string `gorm:"column:layout_json;type:jsonb;not null;default:'{}'"`

	// Origin metadata — same convention as `WorkflowDefinition`.
	// `USER` for UI-authored scenes, `MODULE` if a future manifest
	// surface ships preset scenes alongside widgets. `CreatedByRef`
	// is the composite moduleKey for MODULE rows; empty for USER rows.
	CreatedByType string `gorm:"column:created_by_type;type:text;not null;default:'USER'"`
	CreatedByRef  string `gorm:"column:created_by_ref;type:text;not null;default:''"`

	// Relationships
	Application Application `gorm:"foreignKey:ApplicationID;references:ID"`
}

func (Scene) TableName() string {
	return "scenes"
}
