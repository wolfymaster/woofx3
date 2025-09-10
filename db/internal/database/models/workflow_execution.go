package models

import (
	"time"

	"gorm.io/gorm"
	"github.com/google/uuid"
)

// WorkflowExecutionStatus represents the status of a workflow execution
type WorkflowExecutionStatus string

const (
	// WorkflowStatusPending indicates the workflow is waiting to start
	WorkflowStatusPending WorkflowExecutionStatus = "pending"
	// WorkflowStatusRunning indicates the workflow is currently executing
	WorkflowStatusRunning WorkflowExecutionStatus = "running"
	// WorkflowStatusCompleted indicates the workflow has finished successfully
	WorkflowStatusCompleted WorkflowExecutionStatus = "completed"
	// WorkflowStatusFailed indicates the workflow has failed
	WorkflowStatusFailed WorkflowExecutionStatus = "failed"
	// WorkflowStatusCancelled indicates the workflow was cancelled
	WorkflowStatusCancelled WorkflowExecutionStatus = "cancelled"
)

// WorkflowExecution represents an instance of a workflow execution
type WorkflowExecution struct {
	ID            uuid.UUID             `gorm:"type:uuid;default:uuid_generate_v4();primaryKey" json:"id"`
	WorkflowID    uuid.UUID             `gorm:"type:uuid;not null;index" json:"workflow_id"`
	ApplicationID uuid.UUID             `gorm:"type:uuid;not null;index" json:"application_id"`
	UserID        uuid.UUID             `gorm:"type:uuid;not null;index" json:"user_id"`
	Status        WorkflowExecutionStatus `gorm:"type:varchar(20);not null;default:'pending'" json:"status"`
	Input         string                `gorm:"type:jsonb" json:"input,omitempty"`
	Output        string                `gorm:"type:jsonb" json:"output,omitempty"`
	Error         string                `gorm:"type:text" json:"error,omitempty"`
	StartedAt     *time.Time            `gorm:"index" json:"started_at,omitempty"`
	CompletedAt   *time.Time            `gorm:"index" json:"completed_at,omitempty"`
	CreatedAt     time.Time             `gorm:"not null;default:now()" json:"created_at"`
	UpdatedAt     time.Time             `gorm:"not null;default:now()" json:"updated_at"`

	// Relationships
	Workflow    *WorkflowDefinition `gorm:"foreignKey:WorkflowID" json:"workflow,omitempty"`
	Application *Application        `gorm:"foreignKey:ApplicationID" json:"application,omitempty"`
	User        *User               `gorm:"foreignKey:UserID" json:"user,omitempty"`
}

// TableName specifies the table name for the WorkflowExecution model
func (WorkflowExecution) TableName() string {
	return "workflow_executions"
}

// Create creates a new workflow execution record
func (w *WorkflowExecution) Create(db *gorm.DB) error {
	return db.Create(w).Error
}

// Update updates the workflow execution record
func (w *WorkflowExecution) Update(db *gorm.DB) error {
	return db.Save(w).Error
}

// GetWorkflowExecutionByID retrieves a workflow execution by ID
func GetWorkflowExecutionByID(db *gorm.DB, id uuid.UUID) (*WorkflowExecution, error) {
	var exec WorkflowExecution
	err := db.First(&exec, "id = ?", id).Error
	return &exec, err
}

// GetWorkflowExecutionsByWorkflowID retrieves all executions for a specific workflow
func GetWorkflowExecutionsByWorkflowID(db *gorm.DB, workflowID uuid.UUID, limit, offset int) ([]WorkflowExecution, error) {
	var executions []WorkflowExecution
	err := db.Where("workflow_id = ?", workflowID).
		Order("created_at DESC").
		Limit(limit).Offset(offset).
		Find(&executions).Error
	return executions, err
}

// GetWorkflowExecutionsByUserID retrieves all workflow executions for a specific user
func GetWorkflowExecutionsByUserID(db *gorm.DB, userID uuid.UUID, limit, offset int) ([]WorkflowExecution, error) {
	var executions []WorkflowExecution
	err := db.Where("user_id = ?", userID).
		Order("created_at DESC").
		Limit(limit).Offset(offset).
		Find(&executions).Error
	return executions, err
}

// GetWorkflowExecutionsByStatus retrieves workflow executions by status
func GetWorkflowExecutionsByStatus(db *gorm.DB, status WorkflowExecutionStatus, limit, offset int) ([]WorkflowExecution, error) {
	var executions []WorkflowExecution
	err := db.Where("status = ?", status).
		Order("created_at DESC").
		Limit(limit).Offset(offset).
		Find(&executions).Error
	return executions, err
}

// GetRecentWorkflowExecutions retrieves the most recent workflow executions
func GetRecentWorkflowExecutions(db *gorm.DB, limit int) ([]WorkflowExecution, error) {
	var executions []WorkflowExecution
	err := db.Order("created_at DESC").
		Limit(limit).
		Find(&executions).Error
	return executions, err
}

// MarkAsStarted updates the workflow execution status to running and sets the start time
func (w *WorkflowExecution) MarkAsStarted(db *gorm.DB) error {
	now := time.Now()
	w.Status = WorkflowStatusRunning
	w.StartedAt = &now
	return db.Save(w).Error
}

// MarkAsCompleted updates the workflow execution status to completed and sets the completion time
func (w *WorkflowExecution) MarkAsCompleted(db *gorm.DB, output string) error {
	now := time.Now()
	w.Status = WorkflowStatusCompleted
	w.Output = output
	w.CompletedAt = &now
	return db.Save(w).Error
}

// MarkAsFailed updates the workflow execution status to failed and sets the error message
func (w *WorkflowExecution) MarkAsFailed(db *gorm.DB, errMsg string) error {
	now := time.Now()
	w.Status = WorkflowStatusFailed
	w.Error = errMsg
	w.CompletedAt = &now
	return db.Save(w).Error
}

// MarkAsCancelled updates the workflow execution status to cancelled
func (w *WorkflowExecution) MarkAsCancelled(db *gorm.DB) error {
	now := time.Now()
	w.Status = WorkflowStatusCancelled
	w.CompletedAt = &now
	return db.Save(w).Error
}
