package models

import (
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Every model below is keyed by a UUID id. Where the column has a default it
// is uuid_generate_v4(), which exists only in the Postgres schema; the SQLite
// schema declares the column NOT NULL with no default. So the id is assigned
// here, before any insert, and a row reaches either database with the same
// id. A caller that already chose an id keeps it.
//
// The hook writes into the caller's struct before the insert runs, so after
// a failed Create the struct holds an id no row has. Re-read into a fresh
// value rather than reusing it: gorm adds a non-zero key to the lookup.
//
// TestEveryUUIDKeyedModelAssignsItsIDBeforeCreate fails for a model keyed by
// a UUID id without a hook here.

func assignUUID(id *uuid.UUID) {
	if *id == uuid.Nil {
		*id = uuid.New()
	}
}

func assignUUIDString(id *string) {
	if *id == "" {
		*id = uuid.NewString()
	}
}

func (a *Action) BeforeCreate(*gorm.DB) error {
	assignUUID(&a.ID)
	return nil
}

func (a *Alert) BeforeCreate(*gorm.DB) error {
	assignUUID(&a.ID)
	return nil
}

func (a *Asset) BeforeCreate(*gorm.DB) error {
	assignUUID(&a.ID)
	return nil
}

func (b *BackgroundTask) BeforeCreate(*gorm.DB) error {
	assignUUID(&b.ID)
	return nil
}

func (c *Command) BeforeCreate(*gorm.DB) error {
	assignUUID(&c.ID)
	return nil
}

func (g *Group) BeforeCreate(*gorm.DB) error {
	assignUUID(&g.ID)
	return nil
}

func (m *Module) BeforeCreate(*gorm.DB) error {
	assignUUID(&m.ID)
	return nil
}

func (m *ModuleFunction) BeforeCreate(*gorm.DB) error {
	assignUUID(&m.ID)
	return nil
}

func (m *ModuleResource) BeforeCreate(*gorm.DB) error {
	assignUUID(&m.ID)
	return nil
}

func (m *ModuleResourceInstance) BeforeCreate(*gorm.DB) error {
	assignUUID(&m.ID)
	return nil
}

func (m *ModuleSetting) BeforeCreate(*gorm.DB) error {
	assignUUID(&m.ID)
	return nil
}

func (o *OverlayToken) BeforeCreate(*gorm.DB) error {
	assignUUID(&o.ID)
	return nil
}

func (r *Resource) BeforeCreate(*gorm.DB) error {
	assignUUID(&r.ID)
	return nil
}

func (r *ResourceReference) BeforeCreate(*gorm.DB) error {
	assignUUID(&r.ID)
	return nil
}

func (s *Scene) BeforeCreate(*gorm.DB) error {
	assignUUID(&s.ID)
	return nil
}

func (s *SceneEvent) BeforeCreate(*gorm.DB) error {
	assignUUID(&s.ID)
	return nil
}

func (s *SceneEventLogEntry) BeforeCreate(*gorm.DB) error {
	assignUUID(&s.ID)
	return nil
}

func (s *StreamSession) BeforeCreate(*gorm.DB) error {
	assignUUID(&s.ID)
	return nil
}

func (s *StreamSessionSegment) BeforeCreate(*gorm.DB) error {
	assignUUID(&s.ID)
	return nil
}

func (t *Treat) BeforeCreate(*gorm.DB) error {
	assignUUID(&t.ID)
	return nil
}

func (t *Trigger) BeforeCreate(*gorm.DB) error {
	assignUUID(&t.ID)
	return nil
}

func (u *UserMessage) BeforeCreate(*gorm.DB) error {
	assignUUID(&u.ID)
	return nil
}

func (u *UserMeta) BeforeCreate(*gorm.DB) error {
	assignUUID(&u.ID)
	return nil
}

func (w *Widget) BeforeCreate(*gorm.DB) error {
	assignUUID(&w.ID)
	return nil
}

func (w *WidgetSetting) BeforeCreate(*gorm.DB) error {
	assignUUID(&w.ID)
	return nil
}

func (w *WidgetStatus) BeforeCreate(*gorm.DB) error {
	assignUUID(&w.ID)
	return nil
}

func (w *WorkflowDefinition) BeforeCreate(*gorm.DB) error {
	assignUUID(&w.ID)
	return nil
}

func (w *WorkflowExecution) BeforeCreate(*gorm.DB) error {
	assignUUID(&w.ID)
	return nil
}

func (w *WorkflowExecutionStep) BeforeCreate(*gorm.DB) error {
	assignUUID(&w.ID)
	return nil
}

func (s *SceneBackup) BeforeCreate(*gorm.DB) error {
	assignUUID(&s.ID)
	return nil
}

func (s *StreamGaugeSample) BeforeCreate(*gorm.DB) error {
	assignUUID(&s.ID)
	return nil
}

func (u *UserEvent) BeforeCreate(*gorm.DB) error {
	assignUUID(&u.ID)
	return nil
}

func (u *User) BeforeCreate(*gorm.DB) error {
	assignUUIDString(&u.ID)
	return nil
}

func (w *WorkerEvent) BeforeCreate(*gorm.DB) error {
	assignUUIDString(&w.ID)
	return nil
}
