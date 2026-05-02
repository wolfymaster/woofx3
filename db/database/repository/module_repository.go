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
	// GORM's .Scan(dest) treats a raw `*uuid.UUID` ([16]byte) as an array of
	// uint8 columns and fails with `converting driver.Value type string ...
	// to a uint8`. Scanning into a struct lets GORM bind by column name and
	// correctly invoke uuid.UUID's sql.Scanner.
	var result struct {
		ID uuid.UUID `gorm:"column:id"`
	}
	// Upsert keyed on (created_by_type, created_by_ref, manifest_id) —
	// `manifest_id` is the stable identifier; `name` is display-only and
	// can drift between versions without changing the resource identity.
	err := r.db.Raw(`
		INSERT INTO public.triggers (id, category, name, description, event, config_schema, allow_variants, created_by_type, created_by_ref, manifest_id, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
		ON CONFLICT (created_by_type, created_by_ref, manifest_id) DO UPDATE SET
			category = EXCLUDED.category,
			name = EXCLUDED.name,
			description = EXCLUDED.description,
			event = EXCLUDED.event,
			config_schema = EXCLUDED.config_schema,
			allow_variants = EXCLUDED.allow_variants,
			updated_at = NOW()
		RETURNING id
	`, t.ID, t.Category, t.Name, t.Description, t.Event, t.ConfigSchema, t.AllowVariants, t.CreatedByType, t.CreatedByRef, t.ManifestID).Scan(&result).Error
	if err != nil {
		return err
	}
	t.ID = result.ID
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

// ListTriggersByModulePrefix returns every trigger whose created_by_ref
// starts with `{moduleID}:` — i.e. every trigger installed under any
// version of the given manifest id. Used to fetch the rows that
// `DeleteTriggersByModulePrefix` will remove so the caller can publish a
// deregistration event before the rows disappear.
func (r *ModuleRepository) ListTriggersByModulePrefix(moduleID string) ([]*models.Trigger, error) {
	var triggers []*models.Trigger
	err := r.db.Where(
		"created_by_type = ? AND created_by_ref LIKE ?",
		"MODULE", moduleID+":%",
	).Find(&triggers).Error
	return triggers, err
}

// GetTriggerByModuleAndManifestID resolves a canonical id
// (`{moduleID}:trigger:{manifestID}`) to its row. Two registration
// shapes share the canonical-id space:
//   - MODULE rows store `created_by_ref` as `{moduleId}:{version}:{hash}`
//     and the canonical-id moduleId segment matches the prefix before the
//     first `:`.
//   - non-MODULE rows (SYSTEM built-ins, future integrations) store
//     `created_by_ref` as the bare moduleId segment.
//
// Returns gorm.ErrRecordNotFound if no match.
func (r *ModuleRepository) GetTriggerByModuleAndManifestID(moduleID, manifestID string) (*models.Trigger, error) {
	var trigger models.Trigger
	err := r.db.Where(
		"manifest_id = ? AND ((created_by_type = ? AND created_by_ref LIKE ?) OR (created_by_type <> ? AND created_by_ref = ?))",
		manifestID, "MODULE", moduleID+":%", "MODULE", moduleID,
	).First(&trigger).Error
	if err != nil {
		return nil, err
	}
	return &trigger, nil
}

func (r *ModuleRepository) UpsertAction(a *models.Action) error {
	// See UpsertTrigger: scan RETURNING id into a struct so GORM delegates
	// to uuid.UUID's sql.Scanner instead of treating the array as columns.
	var result struct {
		ID uuid.UUID `gorm:"column:id"`
	}
	// Upsert keyed on (created_by_type, created_by_ref, manifest_id) —
	// `manifest_id` is the stable identifier; `name` is display-only.
	// `type` defaults to "function" at the column level for older rows;
	// new rows pass it explicitly so built-in non-function actions
	// (alert, print) get the right handler name.
	if a.Type == "" {
		a.Type = "function"
	}
	err := r.db.Raw(`
		INSERT INTO public.actions (id, name, description, call, params_schema, created_by_type, created_by_ref, manifest_id, type, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
		ON CONFLICT (created_by_type, created_by_ref, manifest_id) DO UPDATE SET
			name = EXCLUDED.name,
			description = EXCLUDED.description,
			call = EXCLUDED.call,
			params_schema = EXCLUDED.params_schema,
			type = EXCLUDED.type,
			updated_at = NOW()
		RETURNING id
	`, a.ID, a.Name, a.Description, a.Call, a.ParamsSchema, a.CreatedByType, a.CreatedByRef, a.ManifestID, a.Type).Scan(&result).Error
	if err != nil {
		return err
	}
	a.ID = result.ID
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

// ListActionsByModulePrefix mirrors ListTriggersByModulePrefix for the
// actions table. Used to capture rows for the deregistration event before
// they are removed.
func (r *ModuleRepository) ListActionsByModulePrefix(moduleID string) ([]*models.Action, error) {
	var actions []*models.Action
	err := r.db.Where(
		"created_by_type = ? AND created_by_ref LIKE ?",
		"MODULE", moduleID+":%",
	).Find(&actions).Error
	return actions, err
}

// GetActionByModuleAndManifestID mirrors the trigger helper for the
// actions table. See GetTriggerByModuleAndManifestID for the two
// registration shapes (MODULE composite ref vs non-MODULE bare ref) that
// share the canonical-id space.
func (r *ModuleRepository) GetActionByModuleAndManifestID(moduleID, manifestID string) (*models.Action, error) {
	var action models.Action
	err := r.db.Where(
		"manifest_id = ? AND ((created_by_type = ? AND created_by_ref LIKE ?) OR (created_by_type <> ? AND created_by_ref = ?))",
		manifestID, "MODULE", moduleID+":%", "MODULE", moduleID,
	).First(&action).Error
	if err != nil {
		return nil, err
	}
	return &action, nil
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
