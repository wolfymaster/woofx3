package local

import (
        "context"
        "fmt"
)

// Built-in activities for the local workflow engine

// fetchWorkflowDefinitionActivity fetches a workflow definition
func (e *Engine) fetchWorkflowDefinitionActivity(ctx context.Context, params map[string]any) (ExecuteActionResult, error) {
        workflowDefID, ok := params["workflow_def_id"].(string)
        if !ok {
                return ExecuteActionResult{Success: false, Error: "workflow_def_id parameter required"}, nil
        }

        def, err := e.config.WorkflowRepo.GetWorkflowDefinitionByID(ctx, workflowDefID)
        if err != nil {
                return ExecuteActionResult{Success: false, Error: err.Error()}, nil
        }

        return ExecuteActionResult{
                Success: true,
                Exports: map[string]interface{}{
                        "workflow_definition": def,
                },
        }, nil
}

// registerWaitingWorkflowActivity registers a workflow as waiting for an event
func (e *Engine) registerWaitingWorkflowActivity(ctx context.Context, params map[string]any) (engine.ExecuteActionResult, error) {
        workflowID, ok := params["workflow_id"].(string)
        if !ok {
                return ExecuteActionResult{Success: false, Error: "workflow_id parameter required"}, nil
        }

        eventType, ok := params["event_type"].(string)
        if !ok {
                return ExecuteActionResult{Success: false, Error: "event_type parameter required"}, nil
        }

        e.mu.Lock()
        defer e.mu.Unlock()

        if _, exists := e.waitingList[eventType]; !exists {
                e.waitingList[eventType] = make([]string, 0)
        }
        e.waitingList[eventType] = append(e.waitingList[eventType], workflowID)

        return ExecuteActionResult{Success: true}, nil
}

// updateWorkflowStateActivity updates the workflow state
func (e *Engine) updateWorkflowStateActivity(ctx context.Context, params map[string]any) (ExecuteActionResult, error) {
        workflowID, ok := params["workflow_id"].(string)
        if !ok {
                return ExecuteActionResult{Success: false, Error: "workflow_id parameter required"}, nil
        }

        state, ok := params["state"].(map[string]any)
        if !ok {
                return ExecuteActionResult{Success: false, Error: "state parameter required"}, nil
        }

        e.mu.Lock()
        defer e.mu.Unlock()

        if instance, exists := e.workflows[workflowID]; exists {
                if currentStepID, ok := state["currentStepId"].(string); ok {
                        // Update context or state as needed
                        instance.Context.Logger.Info("Workflow state updated", "workflowID", workflowID, "currentStepId", currentStepID)
                }
        }

        return ExecuteActionResult{Success: true}, nil
}

// executeAction is the main activity executor that delegates to registered activities
func (e *Engine) executeAction(ctx context.Context, action string, params map[string]any) (ExecuteActionResult, error) {
        e.mu.RLock()
        activity, exists := e.activities[action]
        e.mu.RUnlock()

        if !exists {
                return ExecuteActionResult{Success: false, Error: fmt.Sprintf("activity not found: %s", action)}, nil
        }

        return activity(ctx, params)
}