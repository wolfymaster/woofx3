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

func (r *ModuleRepository) UpsertTrigger(t *models.ModuleTrigger) error {
	return r.db.Exec(`
		INSERT INTO public.module_triggers (id, module_id, module_name, category, name, description, event, config_schema, allow_variants, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
		ON CONFLICT (module_id, name) DO UPDATE SET
			module_name = EXCLUDED.module_name,
			category = EXCLUDED.category,
			description = EXCLUDED.description,
			event = EXCLUDED.event,
			config_schema = EXCLUDED.config_schema,
			allow_variants = EXCLUDED.allow_variants,
			updated_at = NOW()
	`, t.ID, t.ModuleID, t.ModuleName, t.Category, t.Name, t.Description, t.Event, t.ConfigSchema, t.AllowVariants).Error
}

func (r *ModuleRepository) ListTriggers(moduleNameFilter string) ([]*models.ModuleTrigger, error) {
	var triggers []*models.ModuleTrigger
	q := r.db
	if moduleNameFilter != "" {
		q = q.Where("module_name = ?", moduleNameFilter)
	}
	err := q.Find(&triggers).Error
	return triggers, err
}

func (r *ModuleRepository) DeleteTriggersByModuleID(moduleID uuid.UUID) error {
	return r.db.Where("module_id = ?", moduleID).Delete(&models.ModuleTrigger{}).Error
}
