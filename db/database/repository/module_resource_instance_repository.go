package repository

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
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

// Transaction runs fn in one transaction, bound to ctx.
func (r *ModuleResourceInstanceRepository) Transaction(ctx context.Context, fn func(tx *gorm.DB) error) error {
	return r.db.WithContext(ctx).Transaction(fn)
}

// WithTx is the repository running on tx, such as one Transaction opened.
func (r *ModuleResourceInstanceRepository) WithTx(tx *gorm.DB) *ModuleResourceInstanceRepository {
	return &ModuleResourceInstanceRepository{db: tx}
}

func (r *ModuleResourceInstanceRepository) Create(instance *models.ModuleResourceInstance) error {
	return r.db.Create(instance).Error
}

// Update saves an instance's editable fields. Identity columns are untouched by
// callers, so a save cannot move an instance out from under what references it.
func (r *ModuleResourceInstanceRepository) Update(instance *models.ModuleResourceInstance) error {
	return r.db.Save(instance).Error
}

// CompareAndSetSettings replaces an instance's settings only while the row
// still holds `expected`, the settings text the caller read, in one statement,
// and reports whether it did. A single conditional UPDATE is atomic on both
// SQLite and Postgres, so of two writers that read the same settings only one
// swaps. On Postgres the column is jsonb and the comparison is by value.
func (r *ModuleResourceInstanceRepository) CompareAndSetSettings(id uuid.UUID, expected, settings string) (bool, error) {
	result := r.db.Model(&models.ModuleResourceInstance{}).
		Where("id = ? AND settings = ?", id, expected).
		Updates(map[string]interface{}{"settings": settings, "updated_at": time.Now()})
	return result.RowsAffected > 0, result.Error
}

func (r *ModuleResourceInstanceRepository) Delete(instance *models.ModuleResourceInstance) error {
	return r.db.Delete(instance).Error
}

func (r *ModuleResourceInstanceRepository) GetByID(id uuid.UUID) (*models.ModuleResourceInstance, error) {
	var inst models.ModuleResourceInstance
	err := r.db.Where("id = ?", id).First(&inst).Error
	return &inst, err
}

// GetByIDForUpdate reads an instance and, on Postgres, locks its row until the
// transaction ends, so a settings write to it waits for the caller. SQLite has
// no row locks; its writers are serial anyway.
func (r *ModuleResourceInstanceRepository) GetByIDForUpdate(ctx context.Context, id uuid.UUID) (*models.ModuleResourceInstance, error) {
	var inst models.ModuleResourceInstance
	if err := r.db.WithContext(ctx).Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", id).Take(&inst).Error; err != nil {
		return nil, err
	}
	return &inst, nil
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

// ListAll returns every resource instance across every module. Backs the
// periodic full-snapshot reconcile the Convex UI runs to self-heal its
// cache (the engine is single-tenant, so no further scoping is needed).
func (r *ModuleResourceInstanceRepository) ListAll() ([]*models.ModuleResourceInstance, error) {
	var instances []*models.ModuleResourceInstance
	err := r.db.Find(&instances).Error
	return instances, err
}
