package temporal

import (
	"fmt"
	"sync"
	"time"

	"github.com/wolfymaster/woofx3/wooflow/internal/core"
	"go.temporal.io/sdk/log"
	"go.temporal.io/sdk/workflow"
)

// WorkflowState represents the state of a workflow execution
type WorkflowState struct {
	mu sync.RWMutex
	// Current step index
	CurrentStep int
	// Map of step results
	StepResults map[int]interface{}
	// Map of waiting workflows by event type
	WaitingWorkflows map[string][]string
}

// NewWorkflowState creates a new workflow state
func NewWorkflowState() *WorkflowState {
	return &WorkflowState{
		StepResults:      make(map[int]interface{}),
		WaitingWorkflows: make(map[string][]string),
	}
}

// RegisterWaitingWorkflow registers a workflow as waiting for an event
func (s *WorkflowState) RegisterWaitingWorkflow(eventType string, workflowID string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.WaitingWorkflows[eventType]; !exists {
		s.WaitingWorkflows[eventType] = make([]string, 0)
	}
	s.WaitingWorkflows[eventType] = append(s.WaitingWorkflows[eventType], workflowID)
}

// GetWaitingWorkflows returns all workflows waiting for a specific event type
func (s *WorkflowState) GetWaitingWorkflows(eventType string) []string {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if workflows, exists := s.WaitingWorkflows[eventType]; exists {
		return workflows
	}
	return nil
}

// RemoveWaitingWorkflow removes a workflow from the waiting list
func (s *WorkflowState) RemoveWaitingWorkflow(eventType string, workflowID string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if workflows, exists := s.WaitingWorkflows[eventType]; exists {
		for i, id := range workflows {
			if id == workflowID {
				s.WaitingWorkflows[eventType] = append(workflows[:i], workflows[i+1:]...)
				break
			}
		}
	}
}

// DynamicWorkflowInput represents the input for the dynamic workflow
type DynamicWorkflowInput struct {
	WorkflowDefID string
	TriggerEvent  *core.Event
}

// WorkflowContext represents the execution context for a workflow
type WorkflowContext struct {
	TriggeredBy  *core.Event
	Variables    map[string]any
	Aggregations map[string]any
	StepResults  map[string]any
	Logger       log.Logger
}

// DynamicWorkflow is the main workflow implementation
func DynamicWorkflow(ctx workflow.Context, input DynamicWorkflowInput) (*WorkflowContext, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting dynamic workflow", "workflowID", input.WorkflowDefID)

	// Create workflow context
	context := &WorkflowContext{
		TriggeredBy:  input.TriggerEvent,
		Variables:    make(map[string]any),
		Aggregations: make(map[string]any),
		StepResults:  make(map[string]any),
		Logger:       logger,
	}

	// Fetch workflow definition
	var workflowDef *core.WorkflowDefinition
	err := workflow.ExecuteActivity(
		workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
			StartToCloseTimeout: time.Minute,
		}),
		FetchWorkflowDefinition,
		input.WorkflowDefID,
	).Get(ctx, &workflowDef)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch workflow definition: %w", err)
	}

	// Build dependency graph
	dependencyGraph := buildDependencyGraph(workflowDef.Steps)

	// Track completed steps
	completedSteps := make(map[string]bool)

	// Continue until all steps are completed
	for len(completedSteps) < len(workflowDef.Steps) {
		// Find steps that can be executed
		executableSteps := findExecutableSteps(workflowDef.Steps, dependencyGraph, completedSteps)
		fmt.Println("======================")
		fmt.Printf("%v", executableSteps)
		fmt.Println("======================")
		if len(executableSteps) == 0 && len(completedSteps) < len(workflowDef.Steps) {
			return nil, fmt.Errorf("deadlock detected in workflow execution: circular dependency")
		}

		// Execute steps in parallel
		for _, step := range executableSteps {
			// Update workflow state
			err := workflow.ExecuteActivity(
				workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
					StartToCloseTimeout: time.Minute,
				}),
				UpdateWorkflowState,
				workflow.GetInfo(ctx).WorkflowExecution.ID,
				map[string]any{
					"currentStepId": step.ID,
					"status":        "executing",
				},
			).Get(ctx, nil)
			if err != nil {
				return nil, fmt.Errorf("failed to update workflow state: %w", err)
			}

			// Execute step
			stepResult := make(map[string]any)
			err = executeStep(ctx, context, step, &stepResult)
			if err != nil {
				return nil, fmt.Errorf("failed to run workflow step: %w", err)
			}

			// Store step result
			context.StepResults[step.ID] = stepResult

			// update stepResult to be a struct
			// can return a type ACTIVITY_TIMEOUT or RESPONSE
			// check if type is ACTIVITY_TIMEOUT and then exit the loop
			// we probably want to mark the workflow as complete

			// Handle exports
			if step.Exports != nil {
				for varName, path := range step.Exports {
					value, err := getValueByPath(stepResult, path)

					// TODO: If the expected export value is missing, should be fail the workflow, or continue without?
					if err != nil {
						return nil, fmt.Errorf("failed to get exported value: %w", err)
					}
					context.Variables[varName] = value
				}
			}

			// Mark step as completed
			completedSteps[step.ID] = true
		}
	}

	// Mark workflow as complete
	err = workflow.ExecuteActivity(
		workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
			StartToCloseTimeout: time.Minute,
		}),
		UpdateWorkflowState,
		workflow.GetInfo(ctx).WorkflowExecution.ID,
		map[string]any{
			"status": "completed",
		},
	).Get(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to update workflow state: %w", err)
	}

	return context, nil
}

func executeStep(ctx workflow.Context, wfCtx *WorkflowContext, step core.Step, stepResult *map[string]any) error {
	// Execute step based on type
	var err error
	switch step.Type {
	case "action":
		err = executeActionStep(ctx, wfCtx, step, stepResult)
	case "wait":
		err = executeWaitStep(ctx, wfCtx, step)
	// case "condition":
	// 	err = executeConditionStep(ctx, wfCtx, step, steps, executed)
	// case "loop":
	// 	err = executeLoopStep(ctx, wfCtx, step, steps, executed)
	default:
		return fmt.Errorf("unknown step type: %s", step.Type)
	}

	if err != nil {
		return err
	}

	return nil
}

// buildDependencyGraph creates a map of step IDs to their dependencies
func buildDependencyGraph(steps []core.Step) map[string][]string {
	graph := make(map[string][]string)

	for _, step := range steps {
		dependencies := []string{}

		// Handle explicit dependencies
		if step.DependsOn != nil {
			if len(step.DependsOn) > 0 {
				dependencies = append(dependencies, step.DependsOn...)
			}
		}

		// Handle implicit dependencies from parameters
		if step.Parameters != nil {
			paramDeps := findParameterDependencies(step.Parameters)
			dependencies = append(dependencies, paramDeps...)
		}

		graph[step.ID] = dependencies
	}

	return graph
}

// findExecutableSteps returns steps that can be executed (all dependencies satisfied)
func findExecutableSteps(steps []core.Step, graph map[string][]string, completed map[string]bool) []core.Step {
	var executable []core.Step

	for _, step := range steps {
		// Skip completed steps
		if completed[step.ID] {
			continue
		}

		// Check if all dependencies are completed
		dependencies := graph[step.ID]
		allDepsCompleted := true
		for _, depID := range dependencies {
			if !completed[depID] {
				allDepsCompleted = false
				break
			}
		}

		if allDepsCompleted {
			executable = append(executable, step)
		}
	}

	return executable
}
