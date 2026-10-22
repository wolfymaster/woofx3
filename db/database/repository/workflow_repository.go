package repository

import (
	"fmt"
	"time"

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
// silently turn off a live workflow on every reinstall. The stored value is
// read back into `wf` so the caller reports and publishes the state the row
// actually has, not the one the install asked for.
//
// Only call this for rows with a non-empty ManifestID (MODULE-owned
// workflows). USER-authored workflows (ManifestID == "") should go
// through Create — they're excluded from the partial unique index by
// design, since two independently-authored USER workflows should never
// collide.
func (r *WorkflowRepository) Upsert(wf *models.WorkflowDefinition) error {
	var result struct {
		ID      uuid.UUID `gorm:"column:id"`
		Enabled bool      `gorm:"column:enabled"`
	}
	err := r.db.Raw(`
		INSERT INTO workflow_definitions (id, name, steps, trigger, created_by_type, created_by_ref, manifest_id, taxonomy, enabled)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (created_by_type, created_by_ref, manifest_id) WHERE manifest_id <> '' DO UPDATE SET
			name = EXCLUDED.name,
			steps = EXCLUDED.steps,
			trigger = EXCLUDED.trigger,
			taxonomy = EXCLUDED.taxonomy
		RETURNING id, enabled
	`, wf.ID, wf.Name, wf.Steps, wf.Trigger, wf.CreatedByType, wf.CreatedByRef, wf.ManifestID, wf.Taxonomy, wf.Enabled).Scan(&result).Error
	if err != nil {
		return err
	}
	wf.ID = result.ID
	wf.Enabled = result.Enabled
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

// GetByEnabled retrieves WorkflowDefinitions filtered by enabled status.
// Backed by the `idx_workflow_definitions_enabled` index.
func (r *WorkflowRepository) GetByEnabled(enabled bool) ([]*models.WorkflowDefinition, error) {
	var wfs []*models.WorkflowDefinition
	err := r.db.Where("enabled = ?", enabled).Find(&wfs).Error
	return wfs, err
}

// GetAll retrieves all WorkflowDefinitions
func (r *WorkflowRepository) GetAll() ([]*models.WorkflowDefinition, error) {
	var wfs []*models.WorkflowDefinition
	err := r.db.Find(&wfs).Error
	return wfs, err
}

// GetByName retrieves a WorkflowDefinition by name
func (r *WorkflowRepository) GetByName(name string) (*models.WorkflowDefinition, error) {
	var wf models.WorkflowDefinition
	err := r.db.Where("name = ?", name).First(&wf).Error
	return &wf, err
}

// PruneSettledRuns deletes workflow runs that settled (completed, failed or
// cancelled) before `before`, with their recorded steps, `batchSize` runs per
// transaction, and returns how many runs it deleted. A run still pending or
// running is kept however old it is.
//
// The steps are deleted explicitly rather than left to the foreign key's
// cascade, which SQLite applies only on a connection that enabled it.
func (r *WorkflowRepository) PruneSettledRuns(before time.Time, batchSize int) (int64, error) {
	if batchSize < 1 {
		return 0, fmt.Errorf("prune batch size must be at least 1, got %d", batchSize)
	}
	settled := models.TerminalWorkflowStatuses()
	var total int64
	for {
		var deleted int64
		err := r.db.Transaction(func(tx *gorm.DB) error {
			ids := []uuid.UUID{}
			if err := tx.Model(&models.WorkflowExecution{}).
				Where("status IN ? AND COALESCE(completed_at, updated_at) < ?", settled, before.UTC()).
				Limit(batchSize).
				Pluck("id", &ids).Error; err != nil {
				return err
			}
			if len(ids) == 0 {
				return nil
			}
			if err := tx.Exec(`DELETE FROM workflow_execution_steps WHERE execution_id IN ?`, ids).Error; err != nil {
				return err
			}
			result := tx.Exec(`DELETE FROM workflow_executions WHERE id IN ? AND status IN ?`, ids, settled)
			if result.Error != nil {
				return result.Error
			}
			deleted = result.RowsAffected
			return nil
		})
		if err != nil {
			return total, err
		}
		total += deleted
		if deleted < int64(batchSize) {
			return total, nil
		}
	}
}
