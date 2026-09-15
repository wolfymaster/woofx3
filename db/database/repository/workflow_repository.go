package repository

import (
	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
)

// WorkflowRepository represents the db functions for Workflows
type WorkflowRepository struct {
	db *gorm.DB
}

// NewWorkflowRepository returns a new instance of WorkflowRepository
func NewWorkflowRepository(db *gorm.DB) *WorkflowRepository {
	return &WorkflowRepository{db: db}
}

// DB exposes the underlying *gorm.DB for handler-level helpers.
func (r *WorkflowRepository) DB() *gorm.DB {
	return r.db
}

// Create creates a new WorkflowDefinition
func (r *WorkflowRepository) Create(wf *models.WorkflowDefinition) error {
	return r.db.Create(wf).Error
}

// Upsert creates or updates a MODULE-owned WorkflowDefinition keyed on
// (created_by_type, created_by_ref, manifest_id) — the partial unique
// index added by migration 0026 (only covers rows with a non-empty
// manifest_id, i.e. module-installed workflows). Mirrors
// ModuleRepository.UpsertTrigger: a module upgrade that keeps the same
// workflow id updates the existing row in place instead of inserting a
// duplicate.
//
// `enabled` is deliberately excluded from the UPDATE SET. It's a runtime
// toggle the user controls via setWorkflowEnabled, not manifest content,
// and must survive a module upgrade unchanged — resetting it would
// silently turn off a live workflow on every reinstall.
//
// Only call this for rows with a non-empty ManifestID (MODULE-owned
// workflows). USER-authored workflows (ManifestID == "") should go
// through Create — they're excluded from the partial unique index by
// design, since two independently-authored USER workflows should never
// collide.
func (r *WorkflowRepository) Upsert(wf *models.WorkflowDefinition) error {
	var result struct {
		ID uuid.UUID `gorm:"column:id"`
	}
	err := r.db.Raw(`
		INSERT INTO public.workflow_definitions (id, application_id, name, steps, trigger, created_by_type, created_by_ref, manifest_id, taxonomy, enabled)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (created_by_type, created_by_ref, manifest_id) WHERE manifest_id <> '' DO UPDATE SET
			application_id = EXCLUDED.application_id,
			name = EXCLUDED.name,
			steps = EXCLUDED.steps,
			trigger = EXCLUDED.trigger,
			taxonomy = EXCLUDED.taxonomy
		RETURNING id
	`, wf.ID, wf.ApplicationID, wf.Name, wf.Steps, wf.Trigger, wf.CreatedByType, wf.CreatedByRef, wf.ManifestID, wf.Taxonomy, wf.Enabled).Scan(&result).Error
	if err != nil {
		return err
	}
	wf.ID = result.ID
	return nil
}

// Update updates a WorkflowDefinition
func (r *WorkflowRepository) Update(wf *models.WorkflowDefinition) error {
	return r.db.Save(wf).Error
}

// Delete deletes a WorkflowDefinition
func (r *WorkflowRepository) Delete(wf *models.WorkflowDefinition) error {
	return r.db.Delete(wf).Error
}

// GetByID retrieves a WorkflowDefinition by ID
func (r *WorkflowRepository) GetByID(id uuid.UUID) (*models.WorkflowDefinition, error) {
	var wf models.WorkflowDefinition
	err := r.db.Where("id = ?", id).First(&wf).Error
	return &wf, err
}

// GetByApplicationID retrieves all WorkflowDefinitions for an application
func (r *WorkflowRepository) GetByApplicationID(applicationID uuid.UUID) ([]*models.WorkflowDefinition, error) {
	var wfs []*models.WorkflowDefinition
	err := r.db.Where("application_id = ?", applicationID).Find(&wfs).Error
	return wfs, err
}

// GetByApplicationIDAndEnabled retrieves WorkflowDefinitions for an
// application filtered by enabled status. Backed by the
// `(application_id, enabled)` composite index added in migration 0005.
func (r *WorkflowRepository) GetByApplicationIDAndEnabled(applicationID uuid.UUID, enabled bool) ([]*models.WorkflowDefinition, error) {
	var wfs []*models.WorkflowDefinition
	err := r.db.Where("application_id = ? AND enabled = ?", applicationID, enabled).Find(&wfs).Error
	return wfs, err
}

// GetAll retrieves all WorkflowDefinitions
func (r *WorkflowRepository) GetAll() ([]*models.WorkflowDefinition, error) {
	var wfs []*models.WorkflowDefinition
	err := r.db.Find(&wfs).Error
	return wfs, err
}

// GetByName retrieves a WorkflowDefinition by name and application ID
func (r *WorkflowRepository) GetByName(applicationID uuid.UUID, name string) (*models.WorkflowDefinition, error) {
	var wf models.WorkflowDefinition
	err := r.db.Where("application_id = ? AND name = ?", applicationID, name).First(&wf).Error
	return &wf, err
}
