package models

import (
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type WorkflowDefinition struct {
	ID            uuid.UUID `gorm:"type:uuid;default:uuid_generate_v4();primaryKey"`
	ApplicationID uuid.UUID `gorm:"column:application_id;type:uuid;not null;index:idx_workflow_definitions_application_id;constraint:OnUpdate:CASCADE,OnDelete:CASCADE"`
	Name          string    `gorm:"type:varchar(255);not null"`
	Steps         string    `gorm:"type:jsonb"`
	Trigger       string    `gorm:"type:jsonb"`

	// Origin metadata. CreatedByType is "USER" for UI-authored workflows
	// and "MODULE" for workflows registered by barkloader during a module
	// install. CreatedByRef is the composite moduleKey
	// (`{moduleId}:{version}:{hash}`) for MODULE rows; empty for USER rows.
	// ManifestID is the manifest-local id (e.g. `follow-workflow`) for
	// MODULE rows; empty for USER rows. Together with CreatedByRef this
	// is what the engine derives a UI projectionKey from
	// (`{CreatedByRef}:workflow:{ManifestID}`).
	CreatedByType string `gorm:"column:created_by_type;type:text;not null;default:'USER'"`
	CreatedByRef  string `gorm:"column:created_by_ref;type:text;not null;default:''"`
	ManifestID    string `gorm:"column:manifest_id;type:text;not null;default:''"`

	// Enabled flips on/off whether the workflow runtime
	// (`workflow/manager.go`, `workflow/reconcile.go`) considers this row
	// a candidate to subscribe / execute. Always `false` at create time;
	// the UI's `setWorkflowEnabled` action is the canonical toggle.
	Enabled bool `gorm:"column:enabled;not null;default:false;index:idx_workflow_definitions_application_enabled,priority:2"`

	// Relationships
	Application Application `gorm:"foreignKey:ApplicationID;references:ID"`
}

func (WorkflowDefinition) TableName() string {
	return "workflow_definitions"
}

// CRUD Operations
func (wd *WorkflowDefinition) Create(db *gorm.DB) error {
	return db.Create(wd).Error
}

func (wd *WorkflowDefinition) Update(db *gorm.DB) error {
	return db.Save(wd).Error
}

func (wd *WorkflowDefinition) Delete(db *gorm.DB) error {
	return db.Delete(wd).Error
}

func GetWorkflowDefinitionByID(db *gorm.DB, id uuid.UUID) (*WorkflowDefinition, error) {
	var workflow WorkflowDefinition
	err := db.First(&workflow, "id = ?", id).Error
	return &workflow, err
}

func GetWorkflowDefinitionsByApplicationID(db *gorm.DB, appID uuid.UUID) ([]WorkflowDefinition, error) {
	var workflows []WorkflowDefinition
	err := db.Where("application_id = ?", appID).Find(&workflows).Error
	return workflows, err
}

func GetWorkflowDefinitionByName(db *gorm.DB, appID uuid.UUID, name string) (*WorkflowDefinition, error) {
	var workflow WorkflowDefinition
	err := db.Where("application_id = ? AND name = ?", appID, name).First(&workflow).Error
	return &workflow, err
}
