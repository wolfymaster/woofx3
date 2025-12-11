package services

// import (
// 	"context"
// 	"encoding/json"
// 	"fmt"
// 	"time"

// 	"gorm.io/gorm"
// 	"github.com/google/uuid"

// 	"github.com/wolfymaster/woofx3/db/models"
// )

// type eventService struct {
// 	baseService[models.UserEvent]
// }

// // NewEventService creates a new instance of EventService
// func NewEventService() EventService {
// 	return &eventService{
// 		baseService: baseService[models.UserEvent]{},
// 	}
// }

// // LogEvent logs a new user event
// func (s *eventService) LogEvent(db *gorm.DB, event *models.UserEvent) error {
// 	// Set default values
// 	event.ID = uuid.New()
// 	event.CreatedAt = time.Now()

// 	// Ensure event value is valid JSON if provided
// 	if event.EventValue != "" {
// 		// Try to unmarshal to validate JSON
// 		var temp interface{}
// 		if err := json.Unmarshal([]byte(event.EventValue), &temp); err != nil {
// 			return fmt.Errorf("invalid event value (must be valid JSON): %w", err)
// 		}
// 	}

// 	return s.Create(db, event)
// }

// // GetUserEvents retrieves events for a specific user
// func (s *eventService) GetUserEvents(db *gorm.DB, userID uuid.UUID, limit int) ([]models.UserEvent, error) {
// 	var events []models.UserEvent

// 	// Get the numeric user ID from the database using the UUID
// 	var user models.User
// 	if err := db.Where("id = ?", userID).First(&user).Error; err != nil {
// 		return nil, fmt.Errorf("user not found: %w", err)
// 	}

// 	query := db.Model(&models.UserEvent{}).
// 		Where("userid = ?", user.ID).
// 		Order("createdat DESC")

// 	if limit > 0 {
// 		query = query.Limit(limit)
// 	}

// 	err := query.Find(&events).Error
// 	if err != nil {
// 		return nil, fmt.Errorf("failed to get user events: %w", err)
// 	}

// 	return events, nil
// }

// // GetEventsByType retrieves events of a specific type
// func (s *eventService) GetEventsByType(db *gorm.DB, eventType string, limit int) ([]models.UserEvent, error) {
// 	var events []models.UserEvent

// 	query := db.Model(&models.UserEvent{}).
// 		Where("eventtype = ?", eventType).
// 		Order("createdat DESC")

// 	if limit > 0 {
// 		query = query.Limit(limit)
// 	}

// 	err := query.Find(&events).Error
// 	if err != nil {
// 		return nil, fmt.Errorf("failed to get events by type: %w", err)
// 	}

// 	return events, nil
// }

// // GetApplicationEvents retrieves events for a specific application
// func (s *eventService) GetApplicationEvents(db *gorm.DB, appID uuid.UUID, limit int) ([]models.UserEvent, error) {
// 	var events []models.UserEvent

// 	query := db.Model(&models.UserEvent{}).
// 		Where("application_id = ?", appID).
// 		Order("createdat DESC")

// 	if limit > 0 {
// 		query = query.Limit(limit)
// 	}

// 	err := query.Find(&events).Error
// 	if err != nil {
// 		return nil, fmt.Errorf("failed to get application events: %w", err)
// 	}

// 	return events, nil
// }

// // SearchEvents searches events based on criteria
// func (s *eventService) SearchEvents(
// 	db *gorm.DB,
// 	userID *uuid.UUID,
// 	appID *uuid.UUID,
// 	eventType *string,
// 	startTime *time.Time,
// 	endTime *time.Time,
// 	limit int,
// ) ([]models.UserEvent, error) {
// 	var events []models.UserEvent

// 	query := db.Model(&models.UserEvent{})

// 	if userID != nil {
// 		// Get the numeric user ID from the database using the UUID
// 		var user models.User
// 		if err := db.Where("id = ?", userID).First(&user).Error; err != nil {
// 			return nil, fmt.Errorf("user not found: %w", err)
// 		}
// 		query = query.Where("userid = ?", user.ID)
// 	}

// 	if appID != nil {
// 		query = query.Where("application_id = ?", appID)
// 	}

// 	if eventType != nil {
// 		query = query.Where("eventtype = ?", *eventType)
// 	}

// 	if startTime != nil {
// 		query = query.Where("createdat >= ?", *startTime)
// 	}

// 	if endTime != nil {
// 		query = query.Where("createdat <= ?", *endTime)
// 	}

// 	query = query.Order("createdat DESC")

// 	if limit > 0 {
// 		query = query.Limit(limit)
// 	}

// 	err := query.Find(&events).Error
// 	if err != nil {
// 		return nil, fmt.Errorf("failed to search events: %w", err)
// 	}

// 	return events, nil
// }

// // CleanupOldEvents removes events older than the specified duration
// func (s *eventService) CleanupOldEvents(db *gorm.DB, olderThan time.Duration) (int64, error) {
// 	result := db.Where("createdat < ?", time.Now().Add(-olderThan)).
// 		Delete(&models.UserEvent{})

// 	if result.Error != nil {
// 		return 0, fmt.Errorf("failed to clean up old events: %w", result.Error)
// 	}

// 	return result.RowsAffected, nil
// }
