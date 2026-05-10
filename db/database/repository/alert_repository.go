package repository

import (
	"fmt"
	"time"

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

// GetByEnvelopeID looks up the most recent alert row for a given
// AlertPayload envelope id, scoped by application. Returns
// gorm.ErrRecordNotFound when no row matches. Scoping by application
// id keeps the query backed by the composite index even when an
// envelope id is somehow reused across tenants.
func (r *AlertRepository) GetByEnvelopeID(applicationID uuid.UUID, envelopeID string) (*models.Alert, error) {
	if envelopeID == "" {
		return nil, fmt.Errorf("envelope_id is required")
	}
	var a models.Alert
	err := r.db.
		Where("application_id = ? AND envelope_id = ?", applicationID, envelopeID).
		Order("created_at DESC").
		First(&a).Error
	return &a, err
}

// UpdateLifecycle atomically advances `status` and stamps the matching
// timestamp column for the new state. Returns the updated row.
//
// Allowed states:
//   - "dispatched" → dispatched_at = now (Phase 2: api published broadcast)
//   - "playing"    → played_at = now      (overlay reported mount)
//   - "completed"  → completed_at = now   (overlay reported done)
//   - "failed"     → completed_at = now, error stamped
//   - "timed_out"  → completed_at = now, error stamped (Phase 2: lease expired)
//   - "skipped"    → completed_at = now   (Phase 3: operator skipped)
//
// Idempotent on timestamps: re-applying the same terminal state does
// not overwrite the original timestamp (first transition wins) but
// status flips so a late ack still lands. `error` is always
// overwritten when the transition supplies one.
func (r *AlertRepository) UpdateLifecycle(applicationID uuid.UUID, envelopeID string, status string, errorMsg string) (*models.Alert, error) {
	if envelopeID == "" {
		return nil, fmt.Errorf("envelope_id is required")
	}
	now := time.Now().UTC()
	updates := map[string]interface{}{
		"status":     status,
		"updated_at": now,
	}
	switch status {
	case "dispatched":
		updates["dispatched_at"] = gorm.Expr("COALESCE(dispatched_at, ?)", now)
	case "playing":
		updates["played_at"] = gorm.Expr("COALESCE(played_at, ?)", now)
	case "completed":
		updates["completed_at"] = gorm.Expr("COALESCE(completed_at, ?)", now)
	case "failed":
		updates["completed_at"] = gorm.Expr("COALESCE(completed_at, ?)", now)
		updates["error"] = errorMsg
	case "timed_out":
		updates["completed_at"] = gorm.Expr("COALESCE(completed_at, ?)", now)
		updates["error"] = errorMsg
	case "skipped":
		updates["completed_at"] = gorm.Expr("COALESCE(completed_at, ?)", now)
	default:
		return nil, fmt.Errorf("unsupported lifecycle status %q", status)
	}

	res := r.db.Model(&models.Alert{}).
		Where("application_id = ? AND envelope_id = ?", applicationID, envelopeID).
		Updates(updates)
	if res.Error != nil {
		return nil, res.Error
	}
	if res.RowsAffected == 0 {
		return nil, gorm.ErrRecordNotFound
	}
	return r.GetByEnvelopeID(applicationID, envelopeID)
}

// ListPendingByApplicationID returns alerts that have never been
// dispatched, in chronological order. Used by AlertQueueManager on
// boot to hydrate the in-memory queue from the persistent backstop.
func (r *AlertRepository) ListPendingByApplicationID(applicationID uuid.UUID) ([]*models.Alert, error) {
	var alerts []*models.Alert
	err := r.db.
		Where("application_id = ? AND status = ?", applicationID, "pending").
		Order("created_at ASC").
		Find(&alerts).Error
	return alerts, err
}

func (r *AlertRepository) Delete(id uuid.UUID) error {
	return r.db.Where("id = ?", id).Delete(&models.Alert{}).Error
}
