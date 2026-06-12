package repository

import (
	"time"

	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
)

// OverlayTokenRepository wraps gorm.DB with overlay-token helpers.
// Mirrors SceneRepository — thin and composable, business rules live
// in the service layer.
type OverlayTokenRepository struct {
	db *gorm.DB
}

func NewOverlayTokenRepository(db *gorm.DB) *OverlayTokenRepository {
	return &OverlayTokenRepository{db: db}
}

// DB exposes the underlying *gorm.DB for handler-level helpers
// (used to resolve the default application id from context).
func (r *OverlayTokenRepository) DB() *gorm.DB {
	return r.db
}

func (r *OverlayTokenRepository) Create(t *models.OverlayToken) error {
	return r.db.Create(t).Error
}

func (r *OverlayTokenRepository) Update(t *models.OverlayToken) error {
	return r.db.Save(t).Error
}

func (r *OverlayTokenRepository) GetByID(id uuid.UUID) (*models.OverlayToken, error) {
	var t models.OverlayToken
	err := r.db.Where("id = ?", id).First(&t).Error
	return &t, err
}

func (r *OverlayTokenRepository) GetByToken(token string) (*models.OverlayToken, error) {
	var t models.OverlayToken
	err := r.db.Where("token = ?", token).First(&t).Error
	return &t, err
}

// List filters by scene and/or application; revoked tombstones are
// excluded unless includeRevoked is set. Both filters are optional.
func (r *OverlayTokenRepository) List(sceneID, applicationID *uuid.UUID, includeRevoked bool) ([]*models.OverlayToken, error) {
	var tokens []*models.OverlayToken
	q := r.db
	if sceneID != nil {
		q = q.Where("scene_id = ?", *sceneID)
	}
	if applicationID != nil {
		q = q.Where("application_id = ?", *applicationID)
	}
	if !includeRevoked {
		q = q.Where("status = ?", models.OverlayTokenStatusActive)
	}
	err := q.Order("created_at DESC").Find(&tokens).Error
	return tokens, err
}

// TouchLastUsed stamps last_used_at without touching any other column
// (and without racing concurrent revokes — status is left alone).
func (r *OverlayTokenRepository) TouchLastUsed(id uuid.UUID, at time.Time) error {
	return r.db.Model(&models.OverlayToken{}).
		Where("id = ?", id).
		UpdateColumn("last_used_at", at).Error
}

// Transaction runs fn against a transactional repository so rotate can
// tombstone the old token and mint its replacement atomically.
func (r *OverlayTokenRepository) Transaction(fn func(txRepo *OverlayTokenRepository) error) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		return fn(&OverlayTokenRepository{db: tx})
	})
}
