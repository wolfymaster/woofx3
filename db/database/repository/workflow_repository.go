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

// Create creates a new WorkflowDefinition
func (r *WorkflowRepository) Create(wf *models.WorkflowDefinition) error {
	return r.db.Create(wf).Error
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

// GetByApplicationIDAndEnabled retrieves enabled WorkflowDefinitions for an application
// Note: The model doesn't have an 'enabled' field yet, so this currently just returns all workflows
func (r *WorkflowRepository) GetByApplicationIDAndEnabled(applicationID uuid.UUID, enabled bool) ([]*models.WorkflowDefinition, error) {
	// TODO: Add 'enabled' field to WorkflowDefinition model and implement filtering
	return r.GetByApplicationID(applicationID)
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

