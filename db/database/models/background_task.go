package models

import (
	"time"

	"github.com/google/uuid"
)

type BackgroundTask struct {
	ID            uuid.UUID `gorm:"type:uuid;default:uuid_generate_v4();primaryKey"`
	Name          string    `gorm:"column:name;type:text;not null;default:''"`
	Description   string    `gorm:"column:description;type:text;not null;default:''"`
	Function      string    `gorm:"column:function;type:text;not null"`
	Schedule      string    `gorm:"column:schedule;type:text;not null"`
	CreatedByType string    `gorm:"column:created_by_type;type:text;not null;default:'MODULE'"`
	CreatedByRef  string    `gorm:"column:created_by_ref;type:text;not null;default:''"`
	ManifestID    string    `gorm:"column:manifest_id;type:text;not null;default:''"`
	ApplicationID string    `gorm:"column:application_id;type:text;not null;default:''"`
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

func (BackgroundTask) TableName() string { return "background_tasks" }
