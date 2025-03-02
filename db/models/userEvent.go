package models

import (
	"time"

	"github.com/google/uuid"
)

type UserEvent struct {
	ID         uuid.UUID `gorm:"type:uuid;default:uuid_generate_v4();primaryKey"`
	UserID     int       `gorm:"column:userid;not null;index:idx_userevents_userid"`
	EventType  string    `gorm:"column:eventtype;type:varchar(50);not null;index:idx_userevents_eventtype"`
	EventValue JSONB     `gorm:"column:eventvalue;type:jsonb"`
	CreatedAt  time.Time `gorm:"column:createdat;default:CURRENT_TIMESTAMP;not null"`

	// Relationship
	User User `gorm:"foreignKey:UserID;references:UserID"`
}

func (UserEvent) TableName() string {
	return "userevents"
}
