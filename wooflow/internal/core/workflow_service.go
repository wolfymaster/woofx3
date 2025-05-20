package core

import (
	"context"
	"fmt"
)

// WorkflowService handles business logic for workflow definitions
type WorkflowService struct {
	repo WorkflowDefinitionRepository
}

// NewWorkflowService creates a new workflow service
func NewWorkflowService(repo WorkflowDefinitionRepository) *WorkflowService {
	return &WorkflowService{
		repo: repo,
	}
}

// CreateWorkflowDefinition creates a new workflow definition
func (s *WorkflowService) CreateWorkflowDefinition(ctx context.Context, def *WorkflowDefinition) error {
	if err := s.validateWorkflowDefinition(def); err != nil {
		return fmt.Errorf("invalid workflow definition: %w", err)
	}
	return s.repo.CreateWorkflowDefinition(ctx, def)
}

// GetWorkflowDefinition retrieves a workflow definition by ID
func (s *WorkflowService) GetWorkflowDefinition(ctx context.Context, id string) (*WorkflowDefinition, error) {
	return s.repo.GetWorkflowDefinitionByID(ctx, id)
}

// UpdateWorkflowDefinition updates an existing workflow definition
func (s *WorkflowService) UpdateWorkflowDefinition(ctx context.Context, def *WorkflowDefinition) error {
	if err := s.validateWorkflowDefinition(def); err != nil {
		return fmt.Errorf("invalid workflow definition: %w", err)
	}
	return s.repo.UpdateWorkflowDefinition(ctx, def)
}

// DeleteWorkflowDefinition deletes a workflow definition
func (s *WorkflowService) DeleteWorkflowDefinition(ctx context.Context, id string) error {
	return s.repo.DeleteWorkflowDefinition(ctx, id)
}

// ListWorkflowDefinitions lists workflow definitions based on filter
func (s *WorkflowService) ListWorkflowDefinitions(ctx context.Context, filter *WorkflowDefinitionFilter) ([]*WorkflowDefinition, error) {
	return s.repo.QueryWorkflowDefinitions(ctx, filter)
}

// validateWorkflowDefinition validates a workflow definition
func (s *WorkflowService) validateWorkflowDefinition(def *WorkflowDefinition) error {
	if def.ID == "" {
		return fmt.Errorf("workflow ID is required")
	}
	if def.Name == "" {
		return fmt.Errorf("workflow name is required")
	}
	if len(def.Steps) == 0 {
		return fmt.Errorf("workflow must have at least one step")
	}
	return nil
}
