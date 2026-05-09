package repository

import (
	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
)

// AlertRepository wraps gorm.DB with Alert-specific helpers — same
// thin pattern as `WorkflowRepository` and `SceneRepository`.
type AlertRepository struct {
	db *gorm.DB
}

func NewAlertRepository(db *gorm.DB) *AlertRepository {
	return &AlertRepository{db: db}
}

func (r *AlertRepository) DB() *gorm.DB {
	return r.db
}

func (r *AlertRepository) Create(a *models.Alert) error {
	return r.db.Create(a).Error
}

func (r *AlertRepository) GetByID(id uuid.UUID) (*models.Alert, error) {
	var a models.Alert
	err := r.db.Where("id = ?", id).First(&a).Error
	return &a, err
}

// GetByApplicationID returns alerts ordered newest-first — backed by
// the composite index `idx_alerts_application_created_at`.
//
// `limit <= 0` means "no limit" (returns the full history). Callers
// driving the alert-log UI should always pass a finite limit + offset;
// the no-limit path is for tooling / one-off scripts.
func (r *AlertRepository) GetByApplicationID(applicationID uuid.UUID, limit, offset int) ([]*models.Alert, error) {
	var alerts []*models.Alert
	q := r.db.Where("application_id = ?", applicationID).Order("created_at DESC")
	if limit > 0 {
		q = q.Limit(limit).Offset(offset)
	}
	err := q.Find(&alerts).Error
	return alerts, err
}

// CountByApplicationID returns the total count for pagination headers.
func (r *AlertRepository) CountByApplicationID(applicationID uuid.UUID) (int64, error) {
	var n int64
	err := r.db.Model(&models.Alert{}).Where("application_id = ?", applicationID).Count(&n).Error
	return n, err
}

// UpdateStatus flips the row's `status` column. Used by replay to
// mark the source row as having been replayed without inserting a
// duplicate envelope.
func (r *AlertRepository) UpdateStatus(id uuid.UUID, status string) error {
	return r.db.Model(&models.Alert{}).Where("id = ?", id).Update("status", status).Error
}

func (r *AlertRepository) Delete(id uuid.UUID) error {
	return r.db.Where("id = ?", id).Delete(&models.Alert{}).Error
}
