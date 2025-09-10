package models

import (
	"time"

	"github.com/google/uuid"
)

type Setting struct {
	ID            int       `gorm:"primaryKey;autoIncrement"`
	ApplicationID uuid.UUID `gorm:"column:application_id;type:uuid;not null;index:idx_settings_application_id;constraint:OnUpdate:CASCADE,OnDelete:CASCADE"`
	Key           string    `gorm:"column:key;type:varchar(100);not null"`
	Value         string    `gorm:"column:value;type:text"`
	CreatedAt     time.Time `gorm:"column:created_at;default:CURRENT_TIMESTAMP;not null"`
	UpdatedAt     time.Time `gorm:"column:updated_at;default:CURRENT_TIMESTAMP;not null"`

	// Relationships
	Application Application `gorm:"foreignKey:ApplicationID;references:ID"`
}

func (Setting) TableName() string {
	return "settings"
}
