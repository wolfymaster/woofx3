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

	// Relationships
	// Application Application `gorm:"foreignKey:ApplicationID;references:ID"`
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
