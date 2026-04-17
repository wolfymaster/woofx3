package main

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	dbv1 "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/common/cloudevents"
	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// WorkflowRegistry defines the interface for registering and unregistering workflows
type WorkflowRegistry interface {
	RegisterWorkflow(def *types.WorkflowDefinition) error
	UnregisterWorkflow(id string) error
}

// WorkflowManager handles the lifecycle management of workflows
// It uses a WorkflowRegistry interface to register/unregister workflows
type WorkflowManager struct {
	logger   tasks.Logger
	registry WorkflowRegistry
	dbClient dbv1.WorkflowService
}

func (m *WorkflowManager) SetDbClient(client dbv1.WorkflowService) {
	m.dbClient = client
}

// NewWorkflowManager creates a new WorkflowManager instance
func NewWorkflowManager(logger tasks.Logger, registry WorkflowRegistry, dbClient dbv1.WorkflowService) *WorkflowManager {
	return &WorkflowManager{
		logger:   logger,
		registry: registry,
		dbClient: dbClient,
	}
}

// LoadWorkflowsFromDB loads all enabled workflows from the database
func (m *WorkflowManager) LoadWorkflowsFromDB(ctx context.Context) error {
	if m.dbClient == nil {
		m.logger.Warn("Database client not configured, skipping workflow loading from database")
		return nil
	}

	// Fetch all enabled workflows
	req := &dbv1.ListWorkflowsRequest{
		IncludeDisabled: false,
		PageSize:        1000, // Fetch a large batch
	}

	resp, err := m.dbClient.ListWorkflows(ctx, req)
	if err != nil {
		return fmt.Errorf("failed to list workflows: %w", err)
	}

	if resp.Status != nil && resp.Status.Code != 0 {
		return fmt.Errorf("workflow service returned error: %s", resp.Status.Message)
	}

	loadedCount := 0
	for _, dbWorkflow := range resp.Workflows {
		if !dbWorkflow.GetEnabled() {
			continue
		}

		workflowDef, err := convertDBWorkflowToEngineWorkflow(dbWorkflow)
		if err != nil {
			m.logger.Error("Failed to convert workflow", "workflow_id", dbWorkflow.GetId(), "error", err)
			continue
		}

		if m.registry != nil {
			if err := m.registry.RegisterWorkflow(workflowDef); err != nil {
				m.logger.Error("Failed to register workflow", "workflow_id", workflowDef.ID, "error", err)
				continue
			}
		}

		loadedCount++
		m.logger.Info("Loaded workflow from database", "workflow_id", workflowDef.ID, "name", workflowDef.Name)
	}

	m.logger.Info("Loaded workflows from database", "count", loadedCount)
	return nil
}

// HandleWorkflowCreateOrUpdate registers or updates a workflow in memory
// Note: The event only contains operation and entityID - workflow data must be fetched separately
func (m *WorkflowManager) HandleWorkflowCreateOrUpdate(evt *cloudevents.WorkflowChangeEvent) {
	changeData, err := evt.Data()
	if err != nil {
		m.logger.Error("Failed to extract workflow change data", "error", err)
		return
	}

	// Fetch workflow data from DB using entityID
	ctx := context.Background()
	if m.dbClient == nil {
		m.logger.Warn("Database client not configured, cannot fetch workflow data", "entity_id", changeData.EntityID)
		return
	}

	// Fetch the workflow by ID
	req := &dbv1.GetWorkflowRequest{
		Id: changeData.EntityID,
	}

	resp, err := m.dbClient.GetWorkflow(ctx, req)
	if err != nil {
		m.logger.Error("Failed to fetch workflow from DB", "error", err, "entity_id", changeData.EntityID)
		return
	}

	if resp.Status != nil && resp.Status.Code != 0 {
		m.logger.Error("Workflow service returned error", "error", resp.Status.Message, "entity_id", changeData.EntityID)
		return
	}

	if resp.Workflow == nil {
		m.logger.Warn("Workflow not found in database", "entity_id", changeData.EntityID)
		return
	}

	// Convert DB workflow to engine workflow definition
	workflowDef, err := convertDBWorkflowToEngineWorkflow(resp.Workflow)
	if err != nil {
		m.logger.Error("Failed to convert workflow", "error", err, "entity_id", changeData.EntityID)
		return
	}

	// Register the workflow (this will overwrite if it already exists)
	if m.registry != nil {
		if err := m.registry.RegisterWorkflow(workflowDef); err != nil {
			m.logger.Error("Failed to register workflow", "error", err, "workflow_id", workflowDef.ID)
			return
		}
		m.logger.Info("Workflow registered from event", "workflow_id", workflowDef.ID, "name", workflowDef.Name)
	}
}

// HandleWorkflowDelete notifies the WorkflowApp to remove a workflow
func (m *WorkflowManager) HandleWorkflowDelete(entityID string) {
	if entityID == "" {
		m.logger.Error("Missing entity_id for workflow delete")
		return
	}

	if m.registry != nil {
		if err := m.registry.UnregisterWorkflow(entityID); err != nil {
			m.logger.Warn("Failed to unregister workflow", "error", err, "workflow_id", entityID)
			return
		}
		m.logger.Info("Workflow unregistered from event", "workflow_id", entityID)
	}
}

// convertDBWorkflowToEngineWorkflow converts a DB workflow proto to an engine workflow definition
func convertDBWorkflowToEngineWorkflow(dbWorkflow *dbv1.Workflow) (*types.WorkflowDefinition, error) {
	dbSteps := dbWorkflow.GetSteps()

	// First pass: convert all steps to tasks and build a map for dependency resolution
	tasks := make([]types.TaskDefinition, 0, len(dbSteps))
	stepIDToTaskIndex := make(map[string]int)

	for i, dbStep := range dbSteps {
		task, err := convertDBStepToTask(dbStep)
		if err != nil {
			return nil, fmt.Errorf("failed to convert step %s: %w", dbStep.GetId(), err)
		}
		tasks = append(tasks, *task)
		stepIDToTaskIndex[dbStep.GetId()] = i
	}

	// Second pass: build dependencies from on_success/on_failure relationships
	// If step A has on_success = "step_b", then step_b depends on step_a
	for i, dbStep := range dbSteps {
		stepID := dbStep.GetId()

		// Add dependencies based on which steps point to this step as their next step
		dependsOn := []string{}
		for _, otherStep := range dbSteps {
			if otherStep.GetOnSuccess() == stepID || otherStep.GetOnFailure() == stepID {
				dependsOn = append(dependsOn, otherStep.GetId())
			}
		}

		if len(dependsOn) > 0 {
			tasks[i].DependsOn = dependsOn
		}
	}

	// Try to extract trigger from workflow metadata
	// Since Trigger isn't in the proto, we might need to fetch it separately
	// For now, we'll create a basic workflow without trigger
	// TODO: Fetch trigger information if needed (might require GetWorkflow call or separate field)

	workflowDef := &types.WorkflowDefinition{
		ID:          dbWorkflow.GetId(),
		Name:        dbWorkflow.GetName(),
		Description: dbWorkflow.GetDescription(),
		Tasks:       tasks,
		// Trigger will be set if available in the future
	}

	return workflowDef, nil
}

// convertDBStepToTask converts a DB workflow step proto to a task definition
func convertDBStepToTask(dbStep *dbv1.WorkflowStep) (*types.TaskDefinition, error) {
	// Convert parameters from map[string]string to map[string]any
	parameters := make(map[string]any)
	for k, v := range dbStep.GetParameters() {
		// Try to parse JSON values if they're JSON strings
		var jsonValue any
		if err := json.Unmarshal([]byte(v), &jsonValue); err == nil {
			parameters[k] = jsonValue
		} else {
			parameters[k] = v
		}
	}

	task := &types.TaskDefinition{
		ID:         dbStep.GetId(),
		Type:       dbStep.GetType(),
		Parameters: parameters,
		DependsOn:  []string{}, // Will be populated in second pass
	}

	// Convert exports from outputs map
	if len(dbStep.GetOutputs()) > 0 {
		task.Exports = dbStep.GetOutputs()
	}

	// Handle timeout if specified
	if dbStep.GetTimeoutSeconds() > 0 {
		timeout := types.Duration{Duration: time.Duration(dbStep.GetTimeoutSeconds()) * time.Second}
		task.Timeout = &timeout
	}

	return task, nil
}
