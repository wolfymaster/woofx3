package models

import (
	"time"

	"github.com/google/uuid"
)

// WorkflowGroup is an alert group: a named set of workflows switched on and
// off together. Enabled is the group's own switch; switching it moves the
// members' WorkflowDefinition.Enabled, which stays the only switch the
// runtime reads.
type WorkflowGroup struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey"`
	Name        string    `gorm:"column:name;type:varchar(100);not null"`
	Description string    `gorm:"column:description;type:varchar(500);not null;default:''"`
	Enabled     bool      `gorm:"column:enabled;not null;default:false"`
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

func (WorkflowGroup) TableName() string {
	return "workflow_groups"
}

// WorkflowGroupMember records that a workflow belongs to a group.
type WorkflowGroupMember struct {
	GroupID    uuid.UUID `gorm:"column:group_id;type:uuid;primaryKey"`
	WorkflowID uuid.UUID `gorm:"column:workflow_id;type:uuid;primaryKey"`
	CreatedAt  time.Time
}

func (WorkflowGroupMember) TableName() string {
	return "workflow_group_members"
}
