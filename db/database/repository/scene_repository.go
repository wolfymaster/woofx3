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

func (r *SceneRepository) Delete(s *models.Scene) error {
	return r.db.Delete(s).Error
}

func (r *SceneRepository) GetByID(id uuid.UUID) (*models.Scene, error) {
	var s models.Scene
	err := r.db.Where("id = ?", id).First(&s).Error
	return &s, err
}

func (r *SceneRepository) GetAll() ([]*models.Scene, error) {
	var scenes []*models.Scene
	err := r.db.Find(&scenes).Error
	return scenes, err
}

// GetByName resolves a scene by its name — backed by the unique index
// `idx_scenes_name` so the editor can use names as stable handles.
func (r *SceneRepository) GetByName(name string) (*models.Scene, error) {
	var s models.Scene
	err := r.db.Where("name = ?", name).First(&s).Error
	return &s, err
}
