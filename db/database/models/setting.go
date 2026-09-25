package models

import (
	"time"

	"github.com/google/uuid"
)

type Setting struct {
	ID        int        `gorm:"primaryKey;autoIncrement"`
	UserID    *uuid.UUID `gorm:"column:user_id;type:uuid"` // optional user scope (e.g., Twitch broadcaster id for twitch_token)
	Key       string     `gorm:"column:key;type:varchar(100);not null;uniqueIndex:idx_settings_key"`
	Value     string     `gorm:"column:value;type:text"`
	CreatedAt time.Time  `gorm:"column:created_at;default:CURRENT_TIMESTAMP;not null"`
	UpdatedAt time.Time  `gorm:"column:updated_at;default:CURRENT_TIMESTAMP;not null"`
}

func (Setting) TableName() string {
	return "settings"
}
