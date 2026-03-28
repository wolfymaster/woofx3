package memory

import (
	"context"
	"fmt"
	"sync"

	"github.com/wolfymaster/woofx3/wooflow/internal/core"
	"github.com/wolfymaster/woofx3/wooflow/internal/ports"
)

// WorkflowDefinitionRepository implements the WorkflowDefinitionRepository interface using in-memory storage
type WorkflowDefinitionRepository struct {
	workflows map[string]*core.WorkflowDefinition
	mu        sync.RWMutex
}

// NewWorkflowDefinitionRepository creates a new in-memory workflow definition repository
func NewWorkflowDefinitionRepository() ports.WorkflowDefinitionRepository {
	return &WorkflowDefinitionRepository{
		workflows: make(map[string]*core.WorkflowDefinition),
	}
}

// CreateWorkflowDefinition creates a new workflow definition
func (r *WorkflowDefinitionRepository) CreateWorkflowDefinition(ctx context.Context, workflow *core.WorkflowDefinition) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, exists := r.workflows[workflow.ID]; exists {
		return fmt.Errorf("workflow definition already exists: %s", workflow.ID)
	}

	r.workflows[workflow.ID] = workflow
	return nil
}

// GetWorkflowDefinitionByID retrieves a workflow definition by ID
func (r *WorkflowDefinitionRepository) GetWorkflowDefinitionByID(ctx context.Context, id string) (*core.WorkflowDefinition, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	workflow, ok := r.workflows[id]
	if !ok {
		return nil, fmt.Errorf("workflow definition not found: %s", id)
	}

	return workflow, nil
}

// UpdateWorkflowDefinition updates an existing workflow definition
func (r *WorkflowDefinitionRepository) UpdateWorkflowDefinition(ctx context.Context, workflow *core.WorkflowDefinition) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, exists := r.workflows[workflow.ID]; !exists {
		return fmt.Errorf("workflow definition not found: %s", workflow.ID)
	}

	r.workflows[workflow.ID] = workflow
	return nil
}

// DeleteWorkflowDefinition deletes a workflow definition
func (r *WorkflowDefinitionRepository) DeleteWorkflowDefinition(ctx context.Context, id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, exists := r.workflows[id]; !exists {
		return fmt.Errorf("workflow definition not found: %s", id)
	}

	delete(r.workflows, id)
	return nil
}

// QueryWorkflowDefinitions queries workflow definitions based on filter
func (r *WorkflowDefinitionRepository) QueryWorkflowDefinitions(ctx context.Context, filter *core.WorkflowDefinitionFilter) ([]*core.WorkflowDefinition, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var workflows []*core.WorkflowDefinition
	for _, workflow := range r.workflows {
		if filter.Name == "" || workflow.Name == filter.Name {
			workflows = append(workflows, workflow)
		}
	}

	// Apply limit if specified
	if filter.Limit > 0 && len(workflows) > filter.Limit {
		workflows = workflows[:filter.Limit]
	}

	return workflows, nil
}
