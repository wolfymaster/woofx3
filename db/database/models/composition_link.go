package models

import (
	"time"

	"github.com/google/uuid"
)

// CompositionLink records that one step of a workflow or chat command plays
// a composition (an alert). Steps refer to the composition by id and play
// its latest published version, so these rows are what tells the engine an
// alert is in use.
type CompositionLink struct {
	ID            uuid.UUID `gorm:"type:uuid;primaryKey"`
	CompositionID uuid.UUID `gorm:"column:composition_id;type:uuid;not null;index:idx_composition_links_composition"`
	OwnerKind     string    `gorm:"column:owner_kind;type:text;not null;uniqueIndex:uq_composition_links_owner_step,priority:1"`
	OwnerID       string    `gorm:"column:owner_id;type:text;not null;uniqueIndex:uq_composition_links_owner_step,priority:2"`
	StepID        string    `gorm:"column:step_id;type:text;not null;uniqueIndex:uq_composition_links_owner_step,priority:3"`
	CreatedAt     time.Time `gorm:"column:created_at;not null"`
	UpdatedAt     time.Time `gorm:"column:updated_at;not null"`
}

// The owners a composition link may have.
const (
	CompositionLinkOwnerWorkflow = "workflow"
	CompositionLinkOwnerCommand  = "command"
)

func (CompositionLink) TableName() string {
	return "composition_links"
}
