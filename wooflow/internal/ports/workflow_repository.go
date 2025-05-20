package ports

import (
	"context"

	"github.com/wolfymaster/woofx3/workflow/internal/core"
)

// WorkflowDefinitionRepository defines the interface for workflow definition storage
type WorkflowDefinitionRepository interface {
	// CreateWorkflowDefinition creates a new workflow definition
	CreateWorkflowDefinition(ctx context.Context, workflow *core.WorkflowDefinition) error

	// GetWorkflowDefinitionByID retrieves a workflow definition by ID
	GetWorkflowDefinitionByID(ctx context.Context, id string) (*core.WorkflowDefinition, error)

	// UpdateWorkflowDefinition updates an existing workflow definition
	UpdateWorkflowDefinition(ctx context.Context, workflow *core.WorkflowDefinition) error

	// DeleteWorkflowDefinition deletes a workflow definition
	DeleteWorkflowDefinition(ctx context.Context, id string) error

	// QueryWorkflowDefinitions queries workflow definitions based on filter
	QueryWorkflowDefinitions(ctx context.Context, filter *core.WorkflowDefinitionFilter) ([]*core.WorkflowDefinition, error)
}
