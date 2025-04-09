package models

import (
	"time"

	"github.com/google/uuid"
)

type Command struct {
	ID            uuid.UUID `gorm:"type:uuid;default:uuid_generate_v4();primaryKey"`
	BroadcasterID int       `gorm:"column:broadcaster_id;not null;index:idx_commands_broadcaster_id"`
	Command       string    `gorm:"column:command;type:varchar(255);not null"`
	Type          string    `gorm:"column:type;type:varchar(50);not null;"`
	TypeValue     string    `gorm:"column:type_value;type:varchar(500);"`
	CreatedAt     time.Time `gorm:"column:created_at;default:CURRENT_TIMESTAMP;not null"`
}

func (Command) TableName() string {
	return "commands"
}
