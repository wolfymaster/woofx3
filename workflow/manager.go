package main

import (
	"context"
	"encoding/json"
	"fmt"

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

// HandleWorkflowCreateOrUpdate registers or updates a workflow in memory.
// The event only carries operation + workflowID + applicationID; workflow
// definition data must be fetched separately.
func (m *WorkflowManager) HandleWorkflowCreateOrUpdate(evt *cloudevents.WorkflowChangeEvent) {
	changeData, err := evt.Data()
	if err != nil {
		m.logger.Error("Failed to extract workflow change data", "error", err)
		return
	}

	ctx := context.Background()
	if m.dbClient == nil {
		m.logger.Warn("Database client not configured, cannot fetch workflow data", "workflow_id", changeData.WorkflowID)
		return
	}

	req := &dbv1.GetWorkflowRequest{
		Id: changeData.WorkflowID,
	}

	resp, err := m.dbClient.GetWorkflow(ctx, req)
	if err != nil {
		m.logger.Error("Failed to fetch workflow from DB", "error", err, "workflow_id", changeData.WorkflowID)
		return
	}

	if resp.Status != nil && resp.Status.Code != 0 {
		m.logger.Error("Workflow service returned error", "error", resp.Status.Message, "workflow_id", changeData.WorkflowID)
		return
	}

	if resp.Workflow == nil {
		m.logger.Warn("Workflow not found in database", "workflow_id", changeData.WorkflowID)
		return
	}

	// Respect the disabled flag on the lifecycle path: LoadWorkflowsFromDB
	// and the reconciler both filter on GetEnabled(), so the real-time event
	// path must too — otherwise toggling a workflow off leaves it firing
	// until the next reconcile pass. Unregister is idempotent, so calling it
	// when the workflow was never registered is safe.
	if !resp.Workflow.GetEnabled() {
		if m.registry != nil {
			if err := m.registry.UnregisterWorkflow(changeData.WorkflowID); err != nil {
				m.logger.Warn("Failed to unregister disabled workflow", "error", err, "workflow_id", changeData.WorkflowID)
			}
		}
		return
	}

	workflowDef, err := convertDBWorkflowToEngineWorkflow(resp.Workflow)
	if err != nil {
		m.logger.Error("Failed to convert workflow", "error", err, "workflow_id", changeData.WorkflowID)
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

// convertDBWorkflowToEngineWorkflow converts a DB workflow proto to an
// engine workflow definition.
//
// Sources are `dbWorkflow.GetTriggerJson()` for the trigger config and
// `dbWorkflow.GetStepsJson()` for the task array. The previous design
// duplicated the workflow JSON across `variables._definition`,
// `variables._steps`, and `variables._trigger`; that duplication was
// removed in the canonical-id rework — see Phase C.
func convertDBWorkflowToEngineWorkflow(dbWorkflow *dbv1.Workflow) (*types.WorkflowDefinition, error) {
	def := &types.WorkflowDefinition{
		ID:          dbWorkflow.GetId(),
		Name:        dbWorkflow.GetName(),
		Description: dbWorkflow.GetDescription(),
	}

	if rawTrigger := dbWorkflow.GetTriggerJson(); rawTrigger != "" && rawTrigger != "{}" {
		var trigger types.TriggerConfig
		if err := json.Unmarshal([]byte(rawTrigger), &trigger); err != nil {
			return nil, fmt.Errorf("unmarshal trigger_json for workflow %s: %w", dbWorkflow.GetId(), err)
		}
		def.Trigger = &trigger
	}

	if rawSteps := dbWorkflow.GetStepsJson(); rawSteps != "" && rawSteps != "[]" {
		var tasks []types.TaskDefinition
		if err := json.Unmarshal([]byte(rawSteps), &tasks); err != nil {
			return nil, fmt.Errorf("unmarshal steps_json for workflow %s: %w", dbWorkflow.GetId(), err)
		}
		def.Tasks = tasks
	}

	return def, nil
}

// convertDBStepToTask was the legacy fallback that rebuilt tasks from
// the typed `WorkflowStep` proto array when the `_definition` variable
// was missing. With Phase C the engine reads `steps_json` directly and
// the typed-step path is gone; this function was removed along with
// it. If the typed proto array ever needs to be rehydrated for a UI
// listing, do it at the API boundary, not in the engine path.
