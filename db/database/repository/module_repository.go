package repository

import (
	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
)

type ModuleRepository struct {
	db *gorm.DB
}

func NewModuleRepository(db *gorm.DB) *ModuleRepository {
	return &ModuleRepository{db: db}
}

func (r *ModuleRepository) Create(m *models.Module) error {
	return r.db.Create(m).Error
}

func (r *ModuleRepository) Update(m *models.Module) error {
	return r.db.Save(m).Error
}

func (r *ModuleRepository) Delete(m *models.Module) error {
	return r.db.Delete(m).Error
}

func (r *ModuleRepository) GetByID(id uuid.UUID) (*models.Module, error) {
	var mod models.Module
	err := r.db.Preload("Functions").Where("id = ?", id).First(&mod).Error
	return &mod, err
}

func (r *ModuleRepository) GetByName(name string) (*models.Module, error) {
	var mod models.Module
	err := r.db.Preload("Functions").Where("name = ?", name).First(&mod).Error
	return &mod, err
}

func (r *ModuleRepository) GetByModuleKey(moduleKey string) (*models.Module, error) {
	var mod models.Module
	err := r.db.Preload("Functions").Where("module_key = ?", moduleKey).First(&mod).Error
	return &mod, err
}

func (r *ModuleRepository) GetAll() ([]*models.Module, error) {
	var modules []*models.Module
	err := r.db.Preload("Functions").Find(&modules).Error
	return modules, err
}

func (r *ModuleRepository) GetByState(state string) ([]*models.Module, error) {
	var modules []*models.Module
	err := r.db.Preload("Functions").Where("state = ?", state).Find(&modules).Error
	return modules, err
}

func (r *ModuleRepository) DeleteFunctionsByModuleID(moduleID uuid.UUID) error {
	return r.db.Where("module_id = ?", moduleID).Delete(&models.ModuleFunction{}).Error
}

func (r *ModuleRepository) CreateFunctions(functions []models.ModuleFunction) error {
	if len(functions) == 0 {
		return nil
	}
	return r.db.Create(&functions).Error
}

func (r *ModuleRepository) UpsertTrigger(t *models.Trigger) error {
	var storedID uuid.UUID
	err := r.db.Raw(`
		INSERT INTO public.triggers (id, category, name, description, event, config_schema, allow_variants, created_by_type, created_by_ref, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
		ON CONFLICT (created_by_type, created_by_ref, name) DO UPDATE SET
			category = EXCLUDED.category,
			description = EXCLUDED.description,
			event = EXCLUDED.event,
			config_schema = EXCLUDED.config_schema,
			allow_variants = EXCLUDED.allow_variants,
			updated_at = NOW()
		RETURNING id
	`, t.ID, t.Category, t.Name, t.Description, t.Event, t.ConfigSchema, t.AllowVariants, t.CreatedByType, t.CreatedByRef).Scan(&storedID).Error
	if err != nil {
		return err
	}
	t.ID = storedID
	return nil
}

func (r *ModuleRepository) ListTriggers(createdByType, createdByRef string) ([]*models.Trigger, error) {
	var triggers []*models.Trigger
	q := r.db
	if createdByType != "" {
		q = q.Where("created_by_type = ?", createdByType)
	}
	if createdByRef != "" {
		q = q.Where("created_by_ref = ?", createdByRef)
	}
	err := q.Find(&triggers).Error
	return triggers, err
}

func (r *ModuleRepository) DeleteTriggersByModulePrefix(moduleID string) error {
	return r.db.Where(
		"created_by_type = ? AND created_by_ref LIKE ?",
		"MODULE", moduleID+":%",
	).Delete(&models.Trigger{}).Error
}

func (r *ModuleRepository) UpsertAction(a *models.Action) error {
	var storedID uuid.UUID
	err := r.db.Raw(`
		INSERT INTO public.actions (id, name, description, call, params_schema, created_by_type, created_by_ref, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
		ON CONFLICT (created_by_type, created_by_ref, name) DO UPDATE SET
			description = EXCLUDED.description,
			call = EXCLUDED.call,
			params_schema = EXCLUDED.params_schema,
			updated_at = NOW()
		RETURNING id
	`, a.ID, a.Name, a.Description, a.Call, a.ParamsSchema, a.CreatedByType, a.CreatedByRef).Scan(&storedID).Error
	if err != nil {
		return err
	}
	a.ID = storedID
	return nil
}

func (r *ModuleRepository) ListActions(createdByType, createdByRef string) ([]*models.Action, error) {
	var actions []*models.Action
	q := r.db
	if createdByType != "" {
		q = q.Where("created_by_type = ?", createdByType)
	}
	if createdByRef != "" {
		q = q.Where("created_by_ref = ?", createdByRef)
	}
	err := q.Find(&actions).Error
	return actions, err
}

func (r *ModuleRepository) DeleteActionsByModulePrefix(moduleID string) error {
	return r.db.Where(
		"created_by_type = ? AND created_by_ref LIKE ?",
		"MODULE", moduleID+":%",
	).Delete(&models.Action{}).Error
}

// Module Resources

func (r *ModuleRepository) CreateModuleResource(res *models.ModuleResource) error {
	return r.db.Create(res).Error
}

func (r *ModuleRepository) ListModuleResources(moduleID uuid.UUID, resourceType string) ([]*models.ModuleResource, error) {
	var resources []*models.ModuleResource
	q := r.db.Where("module_id = ?", moduleID)
	if resourceType != "" {
		q = q.Where("resource_type = ?", resourceType)
	}
	err := q.Find(&resources).Error
	return resources, err
}

func (r *ModuleRepository) DeleteModuleResources(moduleID uuid.UUID) error {
	return r.db.Where("module_id = ?", moduleID).Delete(&models.ModuleResource{}).Error
}

func (r *ModuleRepository) UpdateModuleResourceVersion(id uuid.UUID, version string) (*models.ModuleResource, error) {
	var res models.ModuleResource
	if err := r.db.First(&res, "id = ?", id).Error; err != nil {
		return nil, err
	}
	res.CurrentVersion = version
	if err := r.db.Save(&res).Error; err != nil {
		return nil, err
	}
	return &res, nil
}
