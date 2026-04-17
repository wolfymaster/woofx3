package models

import (
	"time"

	"github.com/google/uuid"
)

// ResourceReference represents a single directed edge from a source resource
// (workflow, command, ...) to a target resource (action, trigger, function,
// command, workflow). Edges are rewritten whenever the source is created or
// updated and removed when it is deleted.
type ResourceReference struct {
	ID                  uuid.UUID  `gorm:"type:uuid;default:uuid_generate_v4();primaryKey"`
	ApplicationID       *uuid.UUID `gorm:"column:application_id;type:uuid"`
	SourceType          string     `gorm:"column:source_type;type:text;not null"`
	SourceID            uuid.UUID  `gorm:"column:source_id;type:uuid;not null;index"`
	SourceName          string     `gorm:"column:source_name;type:text;not null"`
	SourceCreatedByType string     `gorm:"column:source_created_by_type;type:text;not null;default:'USER'"`
	SourceCreatedByRef  string     `gorm:"column:source_created_by_ref;type:text;not null;default:''"`
	TargetType          string     `gorm:"column:target_type;type:text;not null"`
	TargetName          string     `gorm:"column:target_name;type:text;not null"`
	TargetID            *uuid.UUID `gorm:"column:target_id;type:uuid"`
	TargetCreatedByRef  *string    `gorm:"column:target_created_by_ref;type:text"`
	Context             string     `gorm:"column:context;type:text"`
	CreatedAt           time.Time  `gorm:"column:created_at;default:CURRENT_TIMESTAMP;not null"`
	UpdatedAt           time.Time  `gorm:"column:updated_at;default:CURRENT_TIMESTAMP;not null"`
}

func (ResourceReference) TableName() string { return "resource_references" }
