package models

import (
	"time"

	"github.com/google/uuid"
)

type UserMessage struct {
	ID        uuid.UUID `gorm:"type:uuid;default:uuid_generate_v4();primaryKey"`
	UserID    int       `gorm:"column:userid;not null;index:idx_usermessages_userid"`
	Message   string    `gorm:"type:text;not null"`
	CreatedAt time.Time `gorm:"column:createdat;default:CURRENT_TIMESTAMP;not null"`

	// Relationship
	User User `gorm:"foreignKey:UserID;references:UserID"`
}

func (UserMessage) TableName() string {
	return "usermessages"
}
