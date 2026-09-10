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
	err := r.db.Preload("Functions", func(db *gorm.DB) *gorm.DB { return db.Where("archived_at IS NULL") }).Where("id = ?", id).First(&mod).Error
	return &mod, err
}

func (r *ModuleRepository) GetByName(name string) (*models.Module, error) {
	var mod models.Module
	err := r.db.Preload("Functions", func(db *gorm.DB) *gorm.DB { return db.Where("archived_at IS NULL") }).Where("module_id = ? OR name = ?", name, name).First(&mod).Error
	return &mod, err
}

func (r *ModuleRepository) GetByModuleID(moduleID string) (*models.Module, error) {
	var mod models.Module
	err := r.db.Preload("Functions", func(db *gorm.DB) *gorm.DB { return db.Where("archived_at IS NULL") }).Where("module_id = ?", moduleID).First(&mod).Error
	return &mod, err
}

func (r *ModuleRepository) GetByModuleKey(moduleKey string) (*models.Module, error) {
	var mod models.Module
	err := r.db.Preload("Functions", func(db *gorm.DB) *gorm.DB { return db.Where("archived_at IS NULL") }).Where("module_key = ?", moduleKey).First(&mod).Error
	return &mod, err
}

func (r *ModuleRepository) GetAll() ([]*models.Module, error) {
	var modules []*models.Module
	err := r.db.Preload("Functions", func(db *gorm.DB) *gorm.DB { return db.Where("archived_at IS NULL") }).Find(&modules).Error
	return modules, err
}

func (r *ModuleRepository) GetByState(state string) ([]*models.Module, error) {
	var modules []*models.Module
	err := r.db.Preload("Functions", func(db *gorm.DB) *gorm.DB { return db.Where("archived_at IS NULL") }).Where("state = ?", state).Find(&modules).Error
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

// ListActiveFunctionsByModuleID returns a module's non-archived
// functions — used to diff the previously installed set against a new
// manifest's functions on upgrade (see CreateModule's layer-2 path).
func (r *ModuleRepository) ListActiveFunctionsByModuleID(moduleID uuid.UUID) ([]models.ModuleFunction, error) {
	var functions []models.ModuleFunction
	err := r.db.Where("module_id = ? AND archived_at IS NULL", moduleID).Find(&functions).Error
	return functions, err
}

// UpsertFunction creates or updates a function keyed on
// (module_id, manifest_id), scoped to the active row via the partial
// unique index added in migration 0029 — same pattern as
// UpsertTrigger/UpsertAction/UpsertWidget. A module upgrade that keeps a
// function's id updates the row in place (new file_key, same identity)
// instead of archiving-and-recreating it.
func (r *ModuleRepository) UpsertFunction(f *models.ModuleFunction) error {
	var result struct {
		ID uuid.UUID `gorm:"column:id"`
	}
	err := r.db.Raw(`
		INSERT INTO public.functions (id, module_id, manifest_id, name, file_name, file_key, entry_point, runtime)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (module_id, manifest_id) WHERE archived_at IS NULL AND manifest_id <> '' DO UPDATE SET
			name = EXCLUDED.name,
			file_name = EXCLUDED.file_name,
			file_key = EXCLUDED.file_key,
			entry_point = EXCLUDED.entry_point,
			runtime = EXCLUDED.runtime
		RETURNING id
	`, f.ID, f.ModuleID, f.ManifestID, f.Name, f.FileName, f.FileKey, f.EntryPoint, f.Runtime).Scan(&result).Error
	if err != nil {
		return err
	}
	f.ID = result.ID
	return nil
}

// ArchiveFunctionByManifestID soft-deletes a single function — used by
// the diff-based upgrade path when a function id present in the
// previously installed manifest is absent from the newly installed one.
// Keeps the row resolvable (a workflow step that invokes this function
// by canonical id keeps working) while excluding it from future
// resolution of *new* function references and from any catalog listing.
func (r *ModuleRepository) ArchiveFunctionByManifestID(moduleID uuid.UUID, manifestID string) error {
	return r.db.Model(&models.ModuleFunction{}).Where(
		"module_id = ? AND manifest_id = ? AND archived_at IS NULL",
		moduleID, manifestID,
	).Update("archived_at", gorm.Expr("NOW()")).Error
}

func (r *ModuleRepository) UpsertTrigger(t *models.Trigger) error {
	// GORM's .Scan(dest) treats a raw `*uuid.UUID` ([16]byte) as an array of
	// uint8 columns and fails with `converting driver.Value type string ...
	// to a uint8`. Scanning into a struct lets GORM bind by column name and
	// correctly invoke uuid.UUID's sql.Scanner.
	var result struct {
		ID uuid.UUID `gorm:"column:id"`
	}
	// Upsert keyed on (created_by_type, created_by_ref, manifest_id),
	// scoped to the active (non-archived) row via the partial unique
	// index added in migration 0029 — `manifest_id` is the stable
	// identifier; `name` is display-only and can drift between versions
	// without changing the resource identity. A conflict can only occur
	// against an active row, so this never resurrects an archived one;
	// archived rows and a fresh insert for the same manifest_id coexist
	// (see AddArchivedAtColumns).
	err := r.db.Raw(`
		INSERT INTO public.triggers (id, taxonomy, name, description, event, config_schema, allow_variants, created_by_type, created_by_ref, manifest_id, application_id, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
		ON CONFLICT (created_by_type, created_by_ref, manifest_id) WHERE archived_at IS NULL DO UPDATE SET
			taxonomy = EXCLUDED.taxonomy,
			name = EXCLUDED.name,
			description = EXCLUDED.description,
			event = EXCLUDED.event,
			config_schema = EXCLUDED.config_schema,
			allow_variants = EXCLUDED.allow_variants,
			application_id = EXCLUDED.application_id,
			updated_at = NOW()
		RETURNING id
	`, t.ID, t.Taxonomy, t.Name, t.Description, t.Event, t.ConfigSchema, t.AllowVariants, t.CreatedByType, t.CreatedByRef, t.ManifestID, t.ApplicationID).Scan(&result).Error
	if err != nil {
		return err
	}
	t.ID = result.ID
	return nil
}

// ListTriggers returns active (non-archived) triggers — this backs the
// UI's catalog / "create workflow" pickers, which should never surface a
// trigger a module upgrade has dropped. Existing workflows still resolve
// archived triggers directly via GetTriggerByModuleAndManifestID /
// GetTriggerByCanonicalId.
func (r *ModuleRepository) ListTriggers(createdByType, createdByRef string) ([]*models.Trigger, error) {
	var triggers []*models.Trigger
	q := r.db.Where("archived_at IS NULL")
	if createdByType != "" {
		q = q.Where("created_by_type = ?", createdByType)
	}
	if createdByRef != "" {
		q = q.Where("created_by_ref = ?", createdByRef)
	}
	err := q.Find(&triggers).Error
	return triggers, err
}

// Returns the number of rows removed. The provenance guard below is
// deliberate -- a user module must not be able to delete SYSTEM rows by
// naming itself after one -- but that means a caller can ask to delete
// something and correctly have nothing happen. Reporting the count is what
// lets them tell that apart from success.
func (r *ModuleRepository) DeleteTriggersByModulePrefix(moduleID string) (int64, error) {
	result := r.db.Where(
		"created_by_type = ? AND created_by_ref = ?",
		"MODULE", moduleID,
	).Delete(&models.Trigger{})
	return result.RowsAffected, result.Error
}

// ArchiveTriggerByManifestID soft-deletes a single trigger — used by the
// diff-based upgrade path when a trigger id present in the previously
// installed manifest is absent from the newly installed one. Unlike a
// hard delete, this keeps the row resolvable by canonical id (any
// workflow that references it keeps working) while hiding it from
// ListTriggers. Only archives an active row — idempotent if called
// again for an already-archived id.
func (r *ModuleRepository) ArchiveTriggerByManifestID(moduleID, manifestID string) error {
	return r.db.Model(&models.Trigger{}).Where(
		"created_by_type = ? AND created_by_ref = ? AND manifest_id = ? AND archived_at IS NULL",
		"MODULE", moduleID, manifestID,
	).Update("archived_at", gorm.Expr("NOW()")).Error
}

// ListTriggersByModulePrefix returns every trigger registered under the
// given stable manifest module id. Used to fetch the rows that
// `DeleteTriggersByModulePrefix` will remove so the caller can publish a
// deregistration event before the rows disappear.
func (r *ModuleRepository) ListTriggersByModulePrefix(moduleID string) ([]*models.Trigger, error) {
	var triggers []*models.Trigger
	err := r.db.Where(
		"created_by_type = ? AND created_by_ref = ?",
		"MODULE", moduleID,
	).Find(&triggers).Error
	return triggers, err
}

// GetTriggerByModuleAndManifestID resolves a canonical id
// (`{moduleID}:trigger:{manifestID}`) to its row. `created_by_ref` stores
// the bare stable manifest module id regardless of creator type (MODULE
// installs upsert in place across versions; non-MODULE rows — SYSTEM
// built-ins, future integrations — already used the bare id) so a single
// equality check resolves both.
//
// Prefers the active row, falling back to an archived one — a trigger a
// module upgrade dropped from its manifest is archived, not deleted
// (see migration 0029), so a workflow created against it keeps
// resolving. `ORDER BY (archived_at IS NULL) DESC` sorts the active row
// (if any) first; there is at most one active row per manifest_id at a
// time (the partial unique index enforces this), but an archived row for
// the same manifest_id can also exist if the resource was removed then
// later re-added.
//
// Returns gorm.ErrRecordNotFound if no match.
//
// Module triggers/actions are instance-global (not scoped by application_id).
// applicationId is carried on workflow/event payloads at runtime only.
func (r *ModuleRepository) GetTriggerByModuleAndManifestID(moduleID, manifestID string) (*models.Trigger, error) {
	var trigger models.Trigger
	err := r.db.Where(
		"manifest_id = ? AND created_by_ref = ?",
		manifestID, moduleID,
	).Order("(archived_at IS NULL) DESC").First(&trigger).Error
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
		INSERT INTO public.actions (id, name, description, call, params_schema, created_by_type, created_by_ref, manifest_id, type, taxonomy, application_id, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
		ON CONFLICT (created_by_type, created_by_ref, manifest_id) WHERE archived_at IS NULL DO UPDATE SET
			name = EXCLUDED.name,
			description = EXCLUDED.description,
			call = EXCLUDED.call,
			params_schema = EXCLUDED.params_schema,
			type = EXCLUDED.type,
			taxonomy = EXCLUDED.taxonomy,
			application_id = EXCLUDED.application_id,
			updated_at = NOW()
		RETURNING id
	`, a.ID, a.Name, a.Description, a.Call, a.ParamsSchema, a.CreatedByType, a.CreatedByRef, a.ManifestID, a.Type, a.Taxonomy, a.ApplicationID).Scan(&result).Error
	if err != nil {
		return err
	}
	a.ID = result.ID
	return nil
}

// ListActions returns active (non-archived) actions — see ListTriggers.
func (r *ModuleRepository) ListActions(createdByType, createdByRef string) ([]*models.Action, error) {
	var actions []*models.Action
	q := r.db.Where("archived_at IS NULL")
	if createdByType != "" {
		q = q.Where("created_by_type = ?", createdByType)
	}
	if createdByRef != "" {
		q = q.Where("created_by_ref = ?", createdByRef)
	}
	err := q.Find(&actions).Error
	return actions, err
}

// Returns the number of rows removed. The provenance guard below is
// deliberate -- a user module must not be able to delete SYSTEM rows by
// naming itself after one -- but that means a caller can ask to delete
// something and correctly have nothing happen. Reporting the count is what
// lets them tell that apart from success.
func (r *ModuleRepository) DeleteActionsByModulePrefix(moduleID string) (int64, error) {
	result := r.db.Where(
		"created_by_type = ? AND created_by_ref = ?",
		"MODULE", moduleID,
	).Delete(&models.Action{})
	return result.RowsAffected, result.Error
}

// ArchiveActionByManifestID mirrors ArchiveTriggerByManifestID for actions.
func (r *ModuleRepository) ArchiveActionByManifestID(moduleID, manifestID string) error {
	return r.db.Model(&models.Action{}).Where(
		"created_by_type = ? AND created_by_ref = ? AND manifest_id = ? AND archived_at IS NULL",
		"MODULE", moduleID, manifestID,
	).Update("archived_at", gorm.Expr("NOW()")).Error
}

// ListActionsByModulePrefix mirrors ListTriggersByModulePrefix for the
// actions table. Used to capture rows for the deregistration event before
// they are removed.
func (r *ModuleRepository) ListActionsByModulePrefix(moduleID string) ([]*models.Action, error) {
	var actions []*models.Action
	err := r.db.Where(
		"created_by_type = ? AND created_by_ref = ?",
		"MODULE", moduleID,
	).Find(&actions).Error
	return actions, err
}

// GetActionByModuleAndManifestID mirrors the trigger helper for the
// actions table. See GetTriggerByModuleAndManifestID for why a single
// equality check on `created_by_ref` resolves both MODULE and non-MODULE
// rows, and for the active-first/archived-fallback ordering.
//
// Module triggers/actions are instance-global (not scoped by application_id).
func (r *ModuleRepository) GetActionByModuleAndManifestID(moduleID, manifestID string) (*models.Action, error) {
	var action models.Action
	err := r.db.Where(
		"manifest_id = ? AND created_by_ref = ?",
		manifestID, moduleID,
	).Order("(archived_at IS NULL) DESC").First(&action).Error
	if err != nil {
		return nil, err
	}
	return &action, nil
}

// Assets — mirror the Action helpers above. Identity comes from
// (created_by_type, created_by_ref, manifest_id), same as triggers
// and actions; module-installer registrations carry the stable manifest
// module id in `created_by_ref` so it stays identical across versions
// and upserts scope cleanly.

func (r *ModuleRepository) UpsertAsset(a *models.Asset) error {
	var result struct {
		ID uuid.UUID `gorm:"column:id"`
	}
	err := r.db.Raw(`
		INSERT INTO public.assets (id, name, description, manifest_path, repository_key, kind, content_type, created_by_type, created_by_ref, manifest_id, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
		ON CONFLICT (created_by_type, created_by_ref, manifest_id) DO UPDATE SET
			name = EXCLUDED.name,
			description = EXCLUDED.description,
			manifest_path = EXCLUDED.manifest_path,
			repository_key = EXCLUDED.repository_key,
			kind = EXCLUDED.kind,
			content_type = EXCLUDED.content_type,
			updated_at = NOW()
		RETURNING id
	`, a.ID, a.Name, a.Description, a.ManifestPath, a.RepositoryKey, a.Kind, a.ContentType,
		a.CreatedByType, a.CreatedByRef, a.ManifestID).Scan(&result).Error
	if err != nil {
		return err
	}
	a.ID = result.ID
	return nil
}

func (r *ModuleRepository) ListAssets(createdByType, createdByRef string) ([]*models.Asset, error) {
	var assets []*models.Asset
	q := r.db
	if createdByType != "" {
		q = q.Where("created_by_type = ?", createdByType)
	}
	if createdByRef != "" {
		q = q.Where("created_by_ref = ?", createdByRef)
	}
	err := q.Find(&assets).Error
	return assets, err
}

// ListAssetsByModulePrefix mirrors ListActionsByModulePrefix — used
// to capture rows for the deregistration event before they're deleted.
func (r *ModuleRepository) ListAssetsByModulePrefix(moduleID string) ([]*models.Asset, error) {
	var assets []*models.Asset
	err := r.db.Where(
		"created_by_type = ? AND created_by_ref = ?",
		"MODULE", moduleID,
	).Find(&assets).Error
	return assets, err
}

// Returns the number of rows removed. The provenance guard below is
// deliberate -- a user module must not be able to delete SYSTEM rows by
// naming itself after one -- but that means a caller can ask to delete
// something and correctly have nothing happen. Reporting the count is what
// lets them tell that apart from success.
func (r *ModuleRepository) DeleteAssetsByModulePrefix(moduleID string) (int64, error) {
	result := r.db.Where(
		"created_by_type = ? AND created_by_ref = ?",
		"MODULE", moduleID,
	).Delete(&models.Asset{})
	return result.RowsAffected, result.Error
}

// Note: assets have no selective per-manifest-id delete/archive path.
// Unlike triggers/actions/functions/widgets, nothing resolves an asset
// by canonical id at runtime, and a widget's baked-in
// `${woofx3_asset_url:...}` reference is already a concrete URL by the
// time it's stored — so an asset a module upgrade drops from its
// manifest is simply left alone: not archived, not deleted. Only a full
// module delete removes asset rows (DeleteAssetsByModulePrefix).

// Module Resources

func (r *ModuleRepository) CreateModuleResource(res *models.ModuleResource) error {
	return r.db.Create(res).Error
}

// UpsertModuleResource creates or updates the ledger row for a
// (module, resource kind, manifest id) triple — the unique key added by
// migration 0028. `original_version` is intentionally left out of the
// UPDATE SET: it's set once, on first install, and never touched again,
// so the ledger always remembers which version first introduced a
// resource even as `current_version` tracks the latest.
func (r *ModuleRepository) UpsertModuleResource(res *models.ModuleResource) error {
	var result struct {
		ID uuid.UUID `gorm:"column:id"`
	}
	err := r.db.Raw(`
		INSERT INTO public.module_resources (id, module_id, resource_type, resource_id, manifest_id, resource_name, original_version, current_version, installed_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
		ON CONFLICT (module_id, resource_type, manifest_id) DO UPDATE SET
			resource_id = EXCLUDED.resource_id,
			resource_name = EXCLUDED.resource_name,
			current_version = EXCLUDED.current_version,
			updated_at = NOW()
		RETURNING id
	`, res.ID, res.ModuleID, res.ResourceType, res.ResourceID, res.ManifestID, res.ResourceName, res.OriginalVersion, res.CurrentVersion).Scan(&result).Error
	if err != nil {
		return err
	}
	res.ID = result.ID
	return nil
}

// DeleteModuleResourceByManifestID removes a single ledger row — the
// counterpart to the selective Delete*ByManifestID methods below, used
// when a resource present in a previously installed manifest is absent
// from the newly installed one.
func (r *ModuleRepository) DeleteModuleResourceByManifestID(moduleID uuid.UUID, resourceType, manifestID string) error {
	return r.db.Where(
		"module_id = ? AND resource_type = ? AND manifest_id = ?",
		moduleID, resourceType, manifestID,
	).Delete(&models.ModuleResource{}).Error
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

// Widgets — mirror the Asset helpers above. Identity comes from
// (created_by_type, created_by_ref, manifest_id), same as triggers,
// actions, and assets.

func (r *ModuleRepository) UpsertWidget(w *models.Widget) error {
	var result struct {
		ID uuid.UUID `gorm:"column:id"`
	}
	err := r.db.Raw(`
		INSERT INTO public.widgets (id, name, description, directory, entry, alert_types, settings_schema, surface, created_by_type, created_by_ref, manifest_id, application_id, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
		ON CONFLICT (created_by_type, created_by_ref, manifest_id) WHERE archived_at IS NULL DO UPDATE SET
			name = EXCLUDED.name,
			description = EXCLUDED.description,
			directory = EXCLUDED.directory,
			entry = EXCLUDED.entry,
			alert_types = EXCLUDED.alert_types,
			settings_schema = EXCLUDED.settings_schema,
			surface = EXCLUDED.surface,
			application_id = EXCLUDED.application_id,
			updated_at = NOW()
		RETURNING id
	`, w.ID, w.Name, w.Description, w.Directory, w.Entry, w.AlertTypes, w.SettingsSchema, w.Surface, w.CreatedByType, w.CreatedByRef, w.ManifestID, w.ApplicationID).Scan(&result).Error
	if err != nil {
		return err
	}
	w.ID = result.ID
	return nil
}

// ListWidgets returns active (non-archived) widgets — see ListTriggers.
func (r *ModuleRepository) ListWidgets(createdByType, createdByRef string) ([]*models.Widget, error) {
	var widgets []*models.Widget
	q := r.db.Where("archived_at IS NULL")
	if createdByType != "" {
		q = q.Where("created_by_type = ?", createdByType)
	}
	if createdByRef != "" {
		q = q.Where("created_by_ref = ?", createdByRef)
	}
	err := q.Find(&widgets).Error
	return widgets, err
}

// ListWidgetsByModulePrefix mirrors ListAssetsByModulePrefix — used
// to capture rows for the deregistration event before they're deleted.
func (r *ModuleRepository) ListWidgetsByModulePrefix(moduleID string) ([]*models.Widget, error) {
	var widgets []*models.Widget
	err := r.db.Where(
		"created_by_type = ? AND created_by_ref = ?",
		"MODULE", moduleID,
	).Find(&widgets).Error
	return widgets, err
}

// GetWidgetByModuleAndManifestID mirrors the trigger helper for widgets.
// See GetTriggerByModuleAndManifestID for why a single equality check on
// `created_by_ref` resolves both MODULE and non-MODULE rows, and for the
// active-first/archived-fallback ordering.
func (r *ModuleRepository) GetWidgetByModuleAndManifestID(moduleID, manifestID string) (*models.Widget, error) {
	var widget models.Widget
	err := r.db.Where(
		"manifest_id = ? AND created_by_ref = ?",
		manifestID, moduleID,
	).Order("(archived_at IS NULL) DESC").First(&widget).Error
	if err != nil {
		return nil, err
	}
	return &widget, nil
}

// Returns the number of rows removed. The provenance guard below is
// deliberate -- a user module must not be able to delete SYSTEM rows by
// naming itself after one -- but that means a caller can ask to delete
// something and correctly have nothing happen. Reporting the count is what
// lets them tell that apart from success.
func (r *ModuleRepository) DeleteWidgetsByModulePrefix(moduleID string) (int64, error) {
	result := r.db.Where(
		"created_by_type = ? AND created_by_ref = ?",
		"MODULE", moduleID,
	).Delete(&models.Widget{})
	return result.RowsAffected, result.Error
}

// ArchiveWidgetByManifestID mirrors ArchiveTriggerByManifestID for widgets.
func (r *ModuleRepository) ArchiveWidgetByManifestID(moduleID, manifestID string) error {
	return r.db.Model(&models.Widget{}).Where(
		"created_by_type = ? AND created_by_ref = ? AND manifest_id = ? AND archived_at IS NULL",
		"MODULE", moduleID, manifestID,
	).Update("archived_at", gorm.Expr("NOW()")).Error
}

func (r *ModuleRepository) UpsertBackgroundTask(t *models.BackgroundTask) error {
	var result struct {
		ID uuid.UUID `gorm:"column:id"`
	}
	err := r.db.Raw(`
		INSERT INTO public.background_tasks (id, name, description, function, schedule, created_by_type, created_by_ref, manifest_id, application_id, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
		ON CONFLICT (created_by_type, created_by_ref, manifest_id) DO UPDATE SET
			name = EXCLUDED.name,
			description = EXCLUDED.description,
			function = EXCLUDED.function,
			schedule = EXCLUDED.schedule,
			application_id = EXCLUDED.application_id,
			updated_at = NOW()
		RETURNING id
	`, t.ID, t.Name, t.Description, t.Function, t.Schedule, t.CreatedByType, t.CreatedByRef, t.ManifestID, t.ApplicationID).Scan(&result).Error
	if err != nil {
		return err
	}
	t.ID = result.ID
	return nil
}

func (r *ModuleRepository) ListBackgroundTasks(createdByType, createdByRef string) ([]*models.BackgroundTask, error) {
	var tasks []*models.BackgroundTask
	q := r.db
	if createdByType != "" {
		q = q.Where("created_by_type = ?", createdByType)
	}
	if createdByRef != "" {
		q = q.Where("created_by_ref = ?", createdByRef)
	}
	err := q.Find(&tasks).Error
	return tasks, err
}

func (r *ModuleRepository) ListBackgroundTasksByModulePrefix(moduleID string) ([]*models.BackgroundTask, error) {
	var tasks []*models.BackgroundTask
	err := r.db.Where(
		"created_by_type = ? AND created_by_ref = ?",
		"MODULE", moduleID,
	).Find(&tasks).Error
	return tasks, err
}

// Returns the number of rows removed. The provenance guard below is
// deliberate -- a user module must not be able to delete SYSTEM rows by
// naming itself after one -- but that means a caller can ask to delete
// something and correctly have nothing happen. Reporting the count is what
// lets them tell that apart from success.
func (r *ModuleRepository) DeleteBackgroundTasksByModulePrefix(moduleID string) (int64, error) {
	result := r.db.Where(
		"created_by_type = ? AND created_by_ref = ?",
		"MODULE", moduleID,
	).Delete(&models.BackgroundTask{})
	return result.RowsAffected, result.Error
}

// DeleteBackgroundTaskByManifestID mirrors DeleteTriggerByManifestID for
// background tasks.
func (r *ModuleRepository) DeleteBackgroundTaskByManifestID(moduleID, manifestID string) error {
	return r.db.Where(
		"created_by_type = ? AND created_by_ref = ? AND manifest_id = ?",
		"MODULE", moduleID, manifestID,
	).Delete(&models.BackgroundTask{}).Error
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
