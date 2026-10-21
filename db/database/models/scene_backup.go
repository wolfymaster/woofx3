package models

import (
	"time"

	"github.com/google/uuid"
)

// SceneBackup is stored scene data a repair replaced because the engine could
// not read it, kept exactly as it was (see `SceneBackup` in scene.proto).
type SceneBackup struct {
	ID           uuid.UUID `gorm:"type:uuid;primaryKey"`
	SceneID      uuid.UUID `gorm:"column:scene_id;type:uuid;not null"`
	Version      string    `gorm:"column:version;type:text;not null"`
	SourceColumn string    `gorm:"column:source_column;type:text;not null"`
	Reason       string    `gorm:"column:reason;type:text;not null"`
	Content      string    `gorm:"column:content;type:text;not null"`
	CreatedAt    time.Time `gorm:"column:created_at"`
}

const (
	SceneBackupReasonUnreadableColumn     = "unreadable_column"
	SceneBackupReasonUnreadablePlacements = "unreadable_placements"
)

func (SceneBackup) TableName() string {
	return "scene_backups"
}
