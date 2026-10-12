package repository

import (
	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
)

// SceneRepository wraps gorm.DB with Scene-specific helpers. Mirrors
// the workflow / setting repositories — keep additions thin and
// composable so the service layer owns business rules.
type SceneRepository struct {
	db *gorm.DB
}

func NewSceneRepository(db *gorm.DB) *SceneRepository {
	return &SceneRepository{db: db}
}

func (r *SceneRepository) Create(s *models.Scene) error {
	return r.db.Create(s).Error
}

func (r *SceneRepository) Update(s *models.Scene) error {
	return r.db.Save(s).Error
}

// UpdateColumns writes only the given columns of one scene in a single
// statement. A nil value stores NULL.
func (r *SceneRepository) UpdateColumns(id uuid.UUID, columns map[string]any) error {
	return r.db.Model(&models.Scene{}).Where("id = ?", id).Updates(columns).Error
}

func (r *SceneRepository) Delete(s *models.Scene) error {
	return r.db.Delete(s).Error
}

func (r *SceneRepository) GetByID(id uuid.UUID) (*models.Scene, error) {
	var s models.Scene
	err := r.db.Where("id = ?", id).First(&s).Error
	return &s, err
}

// ListByKind returns every row of one kind (`models.SceneKind*`).
func (r *SceneRepository) ListByKind(kind string) ([]*models.Scene, error) {
	var scenes []*models.Scene
	err := r.db.Where("kind = ?", kind).Find(&scenes).Error
	return scenes, err
}

// GetByKindAndName resolves a row by its name within its kind, backed by the
// unique index `idx_scenes_kind_name`.
func (r *SceneRepository) GetByKindAndName(kind, name string) (*models.Scene, error) {
	var s models.Scene
	err := r.db.Where("kind = ? AND name = ?", kind, name).First(&s).Error
	return &s, err
}

// NameTaken reports whether a row of `kind` other than `excludeID` already
// has `name`, which the unique index `idx_scenes_kind_name` would refuse.
// A nil `excludeID` checks every row of the kind.
func (r *SceneRepository) NameTaken(kind, name string, excludeID *uuid.UUID) (bool, error) {
	query := r.db.Model(&models.Scene{}).Where("kind = ? AND name = ?", kind, name)
	if excludeID != nil {
		query = query.Where("id <> ?", *excludeID)
	}
	var count int64
	err := query.Count(&count).Error
	return count > 0, err
}
