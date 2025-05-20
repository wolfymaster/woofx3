package ports

import (
	"context"

	"github.com/wolfymaster/woofx3/workflow/internal/core"
)

// WorkflowEngine defines the interface for workflow execution
type WorkflowEngine interface {
	// HandleEvent processes an event and triggers relevant workflows
	HandleEvent(ctx context.Context, event core.Event) error

	// StartWorkflow starts a new workflow instance
	StartWorkflow(ctx context.Context, definitionID string, input map[string]interface{}) error

	// GetWorkflowStatus retrieves the current status of a workflow instance
	GetWorkflowStatus(ctx context.Context, workflowID string) (WorkflowStatus, error)

	// Close closes the workflow engine and releases any resources
	Close()
}

// WorkflowStatus represents the current state of a workflow instance
type WorkflowStatus struct {
	ID         string                 `json:"id"`
	Definition string                 `json:"definition"`
	Status     string                 `json:"status"`
	Input      map[string]interface{} `json:"input"`
	Output     map[string]interface{} `json:"output,omitempty"`
	Error      string                 `json:"error,omitempty"`
	StartedAt  int64                  `json:"started_at"`
	UpdatedAt  int64                  `json:"updated_at"`
}
