package models

import (
	"time"

	"github.com/google/uuid"
)

// Scene is the engine's widget arrangement. Mirrors
// `WorkflowDefinition` in spirit: typed audit columns with two opaque
// JSONB blobs (`widgets_json`, `layout_json`) the engine never inspects.
//
// sceneManager (and the Convex scene editor when present)
// reads this row to compose the final browser-source render. The
// engine's only job here is durable storage + delivery; presentation
// semantics live entirely in the consumer.
type Scene struct {
	ID uuid.UUID `gorm:"type:uuid;default:uuid_generate_v4();primaryKey"`
	// What the row composes, `SceneKindScene` or `SceneKindAlert`, fixed at
	// creation. Names are unique per kind.
	Kind        string `gorm:"column:kind;type:text;not null;default:'scene';uniqueIndex:idx_scenes_kind_name,priority:1"`
	Name        string `gorm:"type:varchar(255);not null;uniqueIndex:idx_scenes_kind_name,priority:2"`
	Description string `gorm:"type:text;not null;default:''"`
	// Array of placed widget instances. Shape:
	// `[{ id, widgetCanonicalId, position: { x, y, width, height },
	//    settings: { ... per-widget overrides ... } }, ... ]`.
	// Stored as a JSON string at the proto boundary; the column itself
	// is JSONB so Postgres validates well-formedness on write.
	WidgetsJSON string `gorm:"column:widgets_json;type:jsonb;not null;default:'[]'"`
	// Canvas-level layout config. Optional; most scenes leave this
	// `{}`. The shape is editor-defined and opaque to the engine.
	LayoutJSON string `gorm:"column:layout_json;type:jsonb;not null;default:'{}'"`
	// The editor's unpublished widgets and layout, the same shapes as the
	// published ones. Nil when the scene has no draft: its draft is then the
	// published scene.
	DraftWidgetsJSON *string `gorm:"column:draft_widgets_json;type:jsonb"`
	DraftLayoutJSON  *string `gorm:"column:draft_layout_json;type:jsonb"`
	// The published document's behaviors, a JSON object keyed by behavior
	// id, and the draft's, nil exactly when the draft documents are.
	BehaviorsJSON      string  `gorm:"column:behaviors_json;type:jsonb;not null;default:'{}'"`
	DraftBehaviorsJSON *string `gorm:"column:draft_behaviors_json;type:jsonb"`
	// The inputs the composition takes, a JSON array of input fields. Not
	// drafted: the scene editor never changes them.
	InputsJSON string `gorm:"column:inputs_json;type:jsonb;not null;default:'[]'"`
	// The scene editor's sync state, a JSON object stored as text so it
	// reads back exactly as written. Nil until an editor has synced the
	// scene, or after it was cleared.
	EditorStateJSON *string `gorm:"column:editor_state_json;type:text"`

	// Origin metadata — same convention as `WorkflowDefinition`.
	// `USER` for UI-authored scenes, `MODULE` if a future manifest
	// surface ships preset scenes alongside widgets. `CreatedByRef`
	// is the composite moduleKey for MODULE rows; empty for USER rows.
	CreatedByType string `gorm:"column:created_by_type;type:text;not null;default:'USER'"`
	CreatedByRef  string `gorm:"column:created_by_ref;type:text;not null;default:''"`

	// Managed by gorm: set on insert, and `UpdatedAt` on every write,
	// draft and editor-state writes included.
	CreatedAt time.Time
	UpdatedAt time.Time
}

// The kinds of composition a scene row holds. A scene is shown by overlays;
// an alert is a library entry alert steps copy their layout from, and is
// never an overlay page.
const (
	SceneKindScene = "scene"
	SceneKindAlert = "alert"
)

func (Scene) TableName() string {
	return "scenes"
}
