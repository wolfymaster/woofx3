package repository

import (
	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
)

// ModuleResourceInstanceRepository wraps gorm.DB with helpers for the
// runtime-created `module_resource_instances` rows. Mirrors the scene /
// module repositories — keep the surface thin so the service layer owns
// business rules (validation, canonical-id derivation, event publishing).
type ModuleResourceInstanceRepository struct {
	db *gorm.DB
}

func NewModuleResourceInstanceRepository(db *gorm.DB) *ModuleResourceInstanceRepository {
	return &ModuleResourceInstanceRepository{db: db}
}

func (r *ModuleResourceInstanceRepository) Create(instance *models.ModuleResourceInstance) error {
	return r.db.Create(instance).Error
}

func (r *ModuleResourceInstanceRepository) Delete(instance *models.ModuleResourceInstance) error {
	return r.db.Delete(instance).Error
}

func (r *ModuleResourceInstanceRepository) GetByID(id uuid.UUID) (*models.ModuleResourceInstance, error) {
	var inst models.ModuleResourceInstance
	err := r.db.Where("id = ?", id).First(&inst).Error
	return &inst, err
}

// GetByModuleKindInstance resolves the unique (module_id, kind, instance_id)
// triple. Backed by the unique index `idx_mri_module_kind_instance`.
func (r *ModuleResourceInstanceRepository) GetByModuleKindInstance(moduleID uuid.UUID, kind, instanceID string) (*models.ModuleResourceInstance, error) {
	var inst models.ModuleResourceInstance
	err := r.db.Where("module_id = ? AND kind = ? AND instance_id = ?", moduleID, kind, instanceID).First(&inst).Error
	return &inst, err
}

// ListByKind returns every instance of the given kind across every
// installed module. Backs the UI picker for `resource_ref` config fields.
func (r *ModuleResourceInstanceRepository) ListByKind(kind string) ([]*models.ModuleResourceInstance, error) {
	var instances []*models.ModuleResourceInstance
	err := r.db.Where("kind = ?", kind).Find(&instances).Error
	return instances, err
}

// ListByModuleID returns every instance owned by the given module.
// Used at uninstall time to surface "you must delete these first"
// conflicts (or to drive a cascade-delete preview).
func (r *ModuleResourceInstanceRepository) ListByModuleID(moduleID uuid.UUID) ([]*models.ModuleResourceInstance, error) {
	var instances []*models.ModuleResourceInstance
	err := r.db.Where("module_id = ?", moduleID).Find(&instances).Error
	return instances, err
}

// CountByModuleID is a cheap existence check for uninstall guards —
// avoids loading the full slice when all the caller needs is "are there
// any".
func (r *ModuleResourceInstanceRepository) CountByModuleID(moduleID uuid.UUID) (int64, error) {
	var count int64
	err := r.db.Model(&models.ModuleResourceInstance{}).Where("module_id = ?", moduleID).Count(&count).Error
	return count, err
}
