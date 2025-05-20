package temporal

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/wolfymaster/woofx3/workflow/internal/core"
	"github.com/wolfymaster/woofx3/workflow/internal/ports"
	"go.temporal.io/sdk/activity"
)

var globalClient *Client

// SetGlobalClient sets the global client instance
func SetGlobalClient(client *Client) {
	globalClient = client
}

// ActivityContext holds the context for activities
type ActivityContext struct {
	WorkflowRepo ports.WorkflowDefinitionRepository
	State        *WorkflowState
}

// FetchWorkflowDefinition fetches a workflow definition
func FetchWorkflowDefinition(ctx context.Context, id string) (*core.WorkflowDefinition, error) {
	if globalClient == nil {
		return nil, fmt.Errorf("global client not set")
	}
	return globalClient.workflowRepo.GetWorkflowDefinitionByID(ctx, id)
}

// UpdateWorkflowState updates the state of a workflow
func UpdateWorkflowState(ctx context.Context, workflowID string, state map[string]any) error {
	// TODO: Implement workflow state persistence
	return nil
}

// PublishTopic represents an optional topic for publishing
type PublishTopic struct {
	Value string
	Valid bool
}

// StepActionResult represents the result of executing a step action
type StepActionResult struct {
	Publish      bool           `json:"publish"`
	PublishData  map[string]any `json:"publishData"`
	PublishTopic PublishTopic   `json:"publishTopic"`
	Exports      map[string]any `json:"exports"`
}

// ExecuteActionInput represents the input for the ExecuteAction activity
type ExecuteActionInput struct {
	Action  string         `json:"action"`
	Params  map[string]any `json:"params"`
	Context map[string]any `json:"context"`
}

// ExecuteActionResult represents the result of the ExecuteAction activity
type ExecuteActionResult struct {
	Publish      bool           `json:"publish"`
	PublishData  map[string]any `json:"publishData"`
	PublishTopic PublishTopic   `json:"publishTopic"`
	Exports      map[string]any `json:"exports"`
}

// ExecuteAction executes a workflow action
func ExecuteAction(ctx context.Context, input ExecuteActionInput) (*ExecuteActionResult, error) {
	if globalClient == nil {
		return nil, fmt.Errorf("global client not set")
	}

	// Get the activity function for the action
	activityFn, exists := globalClient.activities[input.Action]
	if !exists {
		return nil, fmt.Errorf("activity '%s' not found", input.Action)
	}

	// Execute the activity
	stepResult, err := activityFn(ctx, input.Params)
	if err != nil {
		return nil, fmt.Errorf("failed to execute activity '%s': %w", input.Action, err)
	}

	// If publishing is requested, publish to NATS
	if stepResult.Publish && stepResult.PublishTopic.Valid {
		if globalClient.nc == nil {
			return nil, fmt.Errorf("NATS client not initialized")
		}

		// Marshal the publish data
		data, err := json.Marshal(stepResult.PublishData)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal publish data: %w", err)
		}

		// Publish to NATS
		err = globalClient.nc.Publish(stepResult.PublishTopic.Value, data)
		if err != nil {
			return nil, fmt.Errorf("failed to publish to NATS: %w", err)
		}
	}

	return &stepResult, nil
}

// RegisterWaitingWorkflow registers a workflow as waiting for an event
func RegisterWaitingWorkflow(ctx context.Context, workflowID string, eventType string) error {
	if globalClient == nil {
		return fmt.Errorf("global client not set")
	}

	// Register workflow
	globalClient.state.RegisterWaitingWorkflow(eventType, workflowID)
	return nil
}

// RemoveWaitingWorkflow removes a workflow from the waiting list
func RemoveWaitingWorkflow(ctx context.Context, workflowID string, eventType string) error {
	if globalClient == nil {
		return fmt.Errorf("global client not set")
	}

	// Remove workflow
	globalClient.state.RemoveWaitingWorkflow(eventType, workflowID)
	return nil
}

// HandleWaitStep handles a wait step in the workflow
func HandleWaitStep(ctx context.Context, step core.Step, context *WorkflowContext) (any, error) {
	activityCtx := activity.GetInfo(ctx).ActivityID
	activity.GetLogger(ctx).Info("Handling wait step", "activityID", activityCtx, "stepID", step.ID)

	// TODO: Implement wait step handling
	return nil, fmt.Errorf("not implemented")
}

func MediaAlert(ctx context.Context, params map[string]any) (ExecuteActionResult, error) {
	logger := activity.GetLogger(ctx)
	logger.Info("running Media Alert")

	return ExecuteActionResult{
		Publish: true,
		PublishData: map[string]any{
			"command": "alert_message",
			"args":    params,
		},
		PublishTopic: PublishTopic{
			Value: "slobs",
			Valid: true,
		},
		Exports: params,
	}, nil
}

// resolveParameterReferences resolves parameter references in the workflow
func resolveParameterReferences(params map[string]any, context *WorkflowContext) (map[string]any, error) {
	resolved := make(map[string]any)

	// Convert params to JSON string for processing
	paramsJSON, err := json.Marshal(params)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal parameters: %w", err)
	}

	// Replace step references
	paramsStr := string(paramsJSON)
	paramsStr = strings.ReplaceAll(paramsStr, "${steps.", "${")

	// Parse back to map
	err = json.Unmarshal([]byte(paramsStr), &resolved)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal resolved parameters: %w", err)
	}

	return resolved, nil
}

// findParameterDependencies finds dependencies in parameters
func findParameterDependencies(params map[string]interface{}) []string {
	dependencies := make(map[string]bool)

	// Convert params to JSON string for processing
	paramsJSON, err := json.Marshal(params)
	if err != nil {
		return nil
	}

	// Find all ${steps.STEPID.output} patterns
	paramsStr := string(paramsJSON)
	parts := strings.Split(paramsStr, "${steps.")

	for _, part := range parts[1:] {
		stepID := strings.Split(part, ".")[0]
		dependencies[stepID] = true
	}

	// Convert map to slice
	result := make([]string, 0, len(dependencies))
	for dep := range dependencies {
		result = append(result, dep)
	}

	return result
}

// getValueByPath gets a value from an object using a dot-notation path
func getValueByPath(obj interface{}, path string) (interface{}, error) {
	if path == "" {
		return obj, nil
	}

	parts := strings.Split(path, ".")
	current := obj

	for _, part := range parts {
		// Convert current to map
		currentMap, ok := current.(map[string]interface{})
		if !ok {
			return nil, fmt.Errorf("invalid path: %s", path)
		}

		// Get next value
		next, exists := currentMap[part]
		if !exists {
			return nil, fmt.Errorf("path not found: %s", path)
		}

		current = next
	}

	return current, nil
}
