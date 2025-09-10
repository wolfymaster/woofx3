package models

import (
	"time"

	"gorm.io/gorm"
	"github.com/google/uuid"
)

type UserEvent struct {
	ID            uuid.UUID `gorm:"type:uuid;default:uuid_generate_v4();primaryKey"`
	UserID        int       `gorm:"column:userid;not null;index:idx_user_events_userid;constraint:OnUpdate:CASCADE,OnDelete:CASCADE"`
	ApplicationID uuid.UUID `gorm:"type:uuid;not null;index:idx_user_events_appid;constraint:OnUpdate:CASCADE,OnDelete:CASCADE"`
	EventType     string    `gorm:"column:eventtype;type:varchar(50);not null;index:idx_user_events_type"`
	EventValue    string    `gorm:"column:eventvalue;type:jsonb"`
	CreatedAt     time.Time `gorm:"column:createdat;default:CURRENT_TIMESTAMP;not null"`

	// Relationships
	User        User        `gorm:"foreignKey:UserID;references:ID"`
	Application Application `gorm:"foreignKey:ApplicationID;references:ID"`
}

func (UserEvent) TableName() string {
	return "user_events"
}

func (ue *UserEvent) Create(db *gorm.DB) error {
	return db.Create(ue).Error
}

func (ue *UserEvent) Update(db *gorm.DB) error {
	return db.Save(ue).Error
}

func (ue *UserEvent) Delete(db *gorm.DB) error {
	return db.Delete(ue).Error
}

func GetUserEventByID(db *gorm.DB, id uuid.UUID) (*UserEvent, error) {
	var event UserEvent
	err := db.First(&event, "id = ?", id).Error
	return &event, err
}

func GetUserEventsByUserID(db *gorm.DB, userID int, applicationID uuid.UUID) ([]UserEvent, error) {
	var events []UserEvent
	query := db.Where("userid = ?", userID)
	if applicationID != uuid.Nil {
		query = query.Where("application_id = ?", applicationID)
	}
	err := query.Order("createdat DESC").Find(&events).Error
	return events, err
}

func GetUserEventsByType(db *gorm.DB, userID int, applicationID uuid.UUID, eventType string) ([]UserEvent, error) {
	var events []UserEvent
	query := db.Where("userid = ? AND eventtype = ?", userID, eventType)
	if applicationID != uuid.Nil {
		query = query.Where("application_id = ?", applicationID)
	}
	err := query.Order("createdat DESC").Find(&events).Error
	return events, err
}

func GetRecentUserEvents(db *gorm.DB, userID int, applicationID uuid.UUID, limit int) ([]UserEvent, error) {
	var events []UserEvent
	query := db.Where("userid = ?", userID)
	if applicationID != uuid.Nil {
		query = query.Where("application_id = ?", applicationID)
	}
	err := query.Order("createdat DESC").Limit(limit).Find(&events).Error
	return events, err
}

// GetUserEventCount returns the count of events for a user, optionally filtered by application and event type
func GetUserEventCount(db *gorm.DB, userID int, applicationID uuid.UUID, eventType string) (int64, error) {
	var count int64
	query := db.Model(&UserEvent{}).Where("userid = ?", userID)
	
	if applicationID != uuid.Nil {
		query = query.Where("application_id = ?", applicationID)
	}
	if eventType != "" {
		query = query.Where("eventtype = ?", eventType)
	}
	
	err := query.Count(&count).Error
	return count, err
}
