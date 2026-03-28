package repository

import (
	"context"
	"time"

	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type DbEventRepository struct {
	db *gorm.DB
}

func NewDbEventRepository(db *gorm.DB) *DbEventRepository {
	return &DbEventRepository{db: db}
}

func (r *DbEventRepository) Create(event *models.WorkerEvent) error {
	if event.MaxAttempts == 0 {
		event.MaxAttempts = 3
	}
	if event.Status == "" {
		event.Status = models.WorkerEventStatusPending
	}

	return r.db.Create(event).Error
}

func (r *DbEventRepository) FetchPending(ctx context.Context, limit int) ([]*models.WorkerEvent, error) {
	var events []*models.WorkerEvent

	err := r.db.WithContext(ctx).
		Where("status = ?", models.WorkerEventStatusPending).
		Order("created_at ASC").
		Limit(limit).
		Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).
		Find(&events).Error

	return events, err
}

func (r *DbEventRepository) MarkPublished(eventID string) error {
	now := time.Now()
	return r.db.Model(&models.WorkerEvent{}).
		Where("id = ?", eventID).
		Updates(map[string]interface{}{
			"status":       models.WorkerEventStatusPublished,
			"published_at": &now,
			"updated_at":   now,
		}).Error
}

func (r *DbEventRepository) MarkPublishing(eventID string) error {
	now := time.Now()
	return r.db.Model(&models.WorkerEvent{}).
		Where("id = ?", eventID).
		Updates(map[string]interface{}{
			"status":     models.WorkerEventStatusPublishing,
			"attempts":   gorm.Expr("attempts + 1"),
			"updated_at": now,
		}).Error
}

func (r *DbEventRepository) MarkAcknowledged(eventID string) error {
	now := time.Now()
	return r.db.Model(&models.WorkerEvent{}).
		Where("id = ?", eventID).
		Updates(map[string]interface{}{
			"status":          models.WorkerEventStatusAcknowledged,
			"acknowledged_at": &now,
			"updated_at":      now,
		}).Error
}

func (r *DbEventRepository) MarkFailed(eventID string, errorMsg string) error {
	now := time.Now()
	return r.db.Model(&models.WorkerEvent{}).
		Where("id = ?", eventID).
		Updates(map[string]interface{}{
			"status":     models.WorkerEventStatusFailed,
			"last_error": &errorMsg,
			"updated_at": now,
		}).Error
}

func (r *DbEventRepository) IncrementAttempts(eventID string) error {
	return r.db.Model(&models.WorkerEvent{}).
		Where("id = ?", eventID).
		UpdateColumn("attempts", gorm.Expr("attempts + 1")).
		Error
}

func (r *DbEventRepository) GetByID(eventID string) (*models.WorkerEvent, error) {
	var event models.WorkerEvent
	err := r.db.Where("id = ?", eventID).First(&event).Error
	return &event, err
}

func (r *DbEventRepository) CleanupOldEvents(olderThan time.Duration) error {
	cutoff := time.Now().Add(-olderThan)
	return r.db.
		Where("status IN (?, ?, ?) AND updated_at < ?",
			models.WorkerEventStatusPublished,
			models.WorkerEventStatusAcknowledged,
			models.WorkerEventStatusFailed,
			cutoff).
		Delete(&models.WorkerEvent{}).Error
}

