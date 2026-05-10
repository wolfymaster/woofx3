package repository

import (
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// WidgetStatusRepository wraps the gorm DB with per-instance status
// helpers. Same pattern as `AlertRepository`.
type WidgetStatusRepository struct {
	db *gorm.DB
}

func NewWidgetStatusRepository(db *gorm.DB) *WidgetStatusRepository {
	return &WidgetStatusRepository{db: db}
}

func (r *WidgetStatusRepository) DB() *gorm.DB {
	return r.db
}

// Upsert writes the latest value for `(applicationID, instanceID,
// key)` — replacing on conflict. Returns the persisted row so the
// caller can include `created_at` / `updated_at` on the wire.
func (r *WidgetStatusRepository) Upsert(row *models.WidgetStatus) (*models.WidgetStatus, error) {
	if row.ApplicationID == uuid.Nil {
		return nil, fmt.Errorf("application_id is required")
	}
	if row.InstanceID == "" {
		return nil, fmt.Errorf("instance_id is required")
	}
	if row.Key == "" {
		return nil, fmt.Errorf("key is required")
	}
	// gorm's OnConflict + DoUpdates doesn't natively chain the
	// updated set with `Assignments`, so we use clause.AssignmentColumns
	// to carry the new value/occurred_at/module_id/widget_canonical_id
	// onto the existing row.
	err := r.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{
			{Name: "application_id"},
			{Name: "instance_id"},
			{Name: "key"},
		},
		DoUpdates: clause.AssignmentColumns([]string{
			"module_id",
			"widget_canonical_id",
			"value",
			"occurred_at",
			"updated_at",
		}),
	}).Create(row).Error
	if err != nil {
		return nil, err
	}
	// gorm leaves the model with a fresh `id` only on insert; on
	// update, fetch back to get the canonical row.
	return r.Get(row.ApplicationID, row.InstanceID, row.Key)
}

func (r *WidgetStatusRepository) Get(applicationID uuid.UUID, instanceID, key string) (*models.WidgetStatus, error) {
	var row models.WidgetStatus
	err := r.db.
		Where("application_id = ? AND instance_id = ? AND key = ?", applicationID, instanceID, key).
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, gorm.ErrRecordNotFound
	}
	return &row, err
}

// ListByApplicationID returns rows ordered by most-recent-update.
// Optional `moduleID` / `instanceID` filters narrow the result;
// empty string means "no filter on that column."
func (r *WidgetStatusRepository) ListByApplicationID(applicationID uuid.UUID, moduleID, instanceID string, limit, offset int) ([]*models.WidgetStatus, error) {
	q := r.db.Where("application_id = ?", applicationID)
	if moduleID != "" {
		q = q.Where("module_id = ?", moduleID)
	}
	if instanceID != "" {
		q = q.Where("instance_id = ?", instanceID)
	}
	q = q.Order("updated_at DESC")
	if limit > 0 {
		q = q.Limit(limit).Offset(offset)
	}
	var rows []*models.WidgetStatus
	err := q.Find(&rows).Error
	return rows, err
}

func (r *WidgetStatusRepository) CountByApplicationID(applicationID uuid.UUID, moduleID, instanceID string) (int64, error) {
	q := r.db.Model(&models.WidgetStatus{}).Where("application_id = ?", applicationID)
	if moduleID != "" {
		q = q.Where("module_id = ?", moduleID)
	}
	if instanceID != "" {
		q = q.Where("instance_id = ?", instanceID)
	}
	var n int64
	err := q.Count(&n).Error
	return n, err
}

// Delete removes every row matching the supplied filter. When `key`
// is empty, deletes all rows for `(applicationID, instanceID)` —
// useful when a widget instance is removed from a scene.
func (r *WidgetStatusRepository) Delete(applicationID uuid.UUID, instanceID, key string) error {
	q := r.db.Where("application_id = ? AND instance_id = ?", applicationID, instanceID)
	if key != "" {
		q = q.Where("key = ?", key)
	}
	return q.Delete(&models.WidgetStatus{}).Error
}
