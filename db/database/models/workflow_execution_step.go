package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// WorkflowExecutionStep is one task's outcome within a run.
//
// Outputs are the task's exports -- what later steps' `${taskId.*}` expressions
// resolve against -- so they are what a resume has to restore before it can run
// the rest of the workflow. Inputs are the parameters as resolved at run time,
// which is the only record of what a task was actually asked to do: the
// definition holds the unresolved template, not the values it produced.
//
// StepIndex is the task's position in the execution order this run used. That
// order comes from the definition's dependency graph and changes if the
// workflow is edited, so the index records the order as it was rather than as
// it would be recomputed today.
type WorkflowExecutionStep struct {
	ID          uuid.UUID  `gorm:"type:uuid;default:uuid_generate_v4();primaryKey" json:"id"`
	ExecutionID uuid.UUID  `gorm:"type:uuid;not null;index" json:"execution_id"`
	TaskID      string     `gorm:"type:text;not null" json:"task_id"`
	Name        string     `gorm:"type:text;not null;default:''" json:"name"`
	Status      string     `gorm:"type:text;not null" json:"status"`
	Attempt     int        `gorm:"not null;default:1" json:"attempt"`
	StepIndex   int        `gorm:"not null" json:"step_index"`
	Inputs      string     `gorm:"type:jsonb" json:"inputs,omitempty"`
	Outputs     string     `gorm:"type:jsonb" json:"outputs,omitempty"`
	Error       string     `gorm:"type:text" json:"error,omitempty"`
	StartedAt   *time.Time `json:"started_at,omitempty"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`
	DurationMs  int64      `json:"duration_ms,omitempty"`
	CreatedAt   time.Time  `gorm:"not null;default:now()" json:"created_at"`
	UpdatedAt   time.Time  `gorm:"not null;default:now()" json:"updated_at"`
}

// TableName specifies the table name for the WorkflowExecutionStep model
func (WorkflowExecutionStep) TableName() string {
	return "workflow_execution_steps"
}

// UpsertWorkflowExecutionStep writes a step, replacing the existing row for the
// same (execution, task, attempt).
//
// The engine reports a step once it settles, but delivery is at-least-once: a
// retried RPC repeats the same report. Every copy describes the same attempt,
// so they have to collapse into one row. Insert-only would leave the timeline
// showing a step twice with no way to tell which copy was authoritative.
func UpsertWorkflowExecutionStep(db *gorm.DB, step *WorkflowExecutionStep) error {
	return db.Clauses(clause.OnConflict{
		Columns: []clause.Column{
			{Name: "execution_id"},
			{Name: "task_id"},
			{Name: "attempt"},
		},
		DoUpdates: clause.AssignmentColumns([]string{
			"name",
			"status",
			"step_index",
			"inputs",
			"outputs",
			"error",
			"started_at",
			"completed_at",
			"duration_ms",
			"updated_at",
		}),
	}).Create(step).Error
}

// GetWorkflowExecutionSteps returns one run's steps in the order it ran them.
func GetWorkflowExecutionSteps(db *gorm.DB, executionID uuid.UUID) ([]WorkflowExecutionStep, error) {
	var steps []WorkflowExecutionStep
	err := db.Where("execution_id = ?", executionID).
		Order("step_index ASC").
		Find(&steps).Error
	return steps, err
}
