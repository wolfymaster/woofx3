package local

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/wolfymaster/woofx3/wooflow/internal/core"
	"go.temporal.io/sdk/log"
)

// Engine is a local implementation of the workflow engine
type Engine struct {
	config       Config
	activities   map[string]core.ActivityFunc
	workflows    map[string]*WorkflowInstance
	waitingList  map[string][]string // event type -> workflow IDs
	state        *EngineState
	running      bool
	mu           sync.RWMutex
	ctx          context.Context
	cancel       context.CancelFunc
	workflowChan chan *WorkflowInstance
}

// Config holds configuration for the local engine
type Config struct {
	MaxConcurrentWorkflows int
	WorkflowTimeout        int // seconds
	TaskQueue              string
	Logger                 log.Logger
	EventRepo              core.EventRepository
	WorkflowRepo           core.WorkflowDefinitionRepository
	NatsConn               *nats.Conn
}

// Use the api types
type ActivityFunc = core.ActivityFunc
type ExecuteActionResult = core.ExecuteActionResult

// WorkflowInstance represents a running workflow instance
type WorkflowInstance struct {
	ID           string
	DefinitionID string
	Definition   *core.WorkflowDefinition
	Context      *WorkflowContext
	State        WorkflowInstanceState
	CreatedAt    time.Time
	UpdatedAt    time.Time
	CompletedAt  *time.Time
	Error        error
	mu           sync.RWMutex
}

// WorkflowContext holds the runtime context for a workflow
type WorkflowContext struct {
	TriggeredBy  *core.Event
	Variables    map[string]any
	Aggregations map[string]any
	StepResults  map[string]any
	Logger       log.Logger
}

// WorkflowInstanceState represents the state of a workflow instance
type WorkflowInstanceState string

const (
	StateRunning   WorkflowInstanceState = "running"
	StateCompleted WorkflowInstanceState = "completed"
	StateFailed    WorkflowInstanceState = "failed"
	StateWaiting   WorkflowInstanceState = "waiting"
)

// EngineState holds the overall state of the engine
type EngineState struct {
	RunningWorkflows   int
	CompletedWorkflows int
	FailedWorkflows    int
	WaitingWorkflows   int
	StartedAt          time.Time
}

// NewEngine creates a new local workflow engine
func NewEngine(config Config) (*Engine, error) {
	if config.MaxConcurrentWorkflows <= 0 {
		config.MaxConcurrentWorkflows = 10
	}
	if config.WorkflowTimeout <= 0 {
		config.WorkflowTimeout = 300 // 5 minutes
	}

	ctx, cancel := context.WithCancel(context.Background())

	engine := &Engine{
		config:       config,
		activities:   make(map[string]core.ActivityFunc),
		workflows:    make(map[string]*WorkflowInstance),
		waitingList:  make(map[string][]string),
		state:        &EngineState{StartedAt: time.Now()},
		ctx:          ctx,
		cancel:       cancel,
		workflowChan: make(chan *WorkflowInstance, config.MaxConcurrentWorkflows),
	}

	// Register built-in activities
	engine.registerBuiltinActivities()

	return engine, nil
}

// Start initializes and starts the local workflow engine
func (e *Engine) Start(ctx context.Context) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	if e.running {
		return fmt.Errorf("engine already running")
	}

	e.running = true

	// Start workflow workers
	for i := 0; i < e.config.MaxConcurrentWorkflows; i++ {
		go e.workflowWorker()
	}

	e.config.Logger.Info("Local workflow engine started",
		"maxConcurrentWorkflows", e.config.MaxConcurrentWorkflows,
		"workflowTimeout", e.config.WorkflowTimeout)

	return nil
}

// Stop shuts down the workflow engine gracefully
func (e *Engine) Stop() error {
	e.mu.Lock()
	defer e.mu.Unlock()

	if !e.running {
		return nil
	}

	e.running = false
	e.cancel()
	close(e.workflowChan)

	// Wait for running workflows to complete (with timeout)
	timeout := time.After(30 * time.Second)
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-timeout:
			e.config.Logger.Warn("Timeout waiting for workflows to complete")
			return nil
		case <-ticker.C:
			if e.state.RunningWorkflows == 0 {
				e.config.Logger.Info("Local workflow engine stopped")
				return nil
			}
		}
	}
}

// HandleEvent processes an event and triggers/signals workflows
func (e *Engine) HandleEvent(ctx context.Context, event *core.Event) error {
	if !e.running {
		return fmt.Errorf("engine not running")
	}

	// Store event
	if err := e.config.EventRepo.StoreEvent(ctx, event); err != nil {
		return fmt.Errorf("failed to store event: %w", err)
	}

	// Find workflows that should be triggered by this event
	definitions, err := e.config.WorkflowRepo.QueryWorkflowDefinitions(ctx, &core.WorkflowDefinitionFilter{
		TriggerEvent: event.Type,
		Limit:        100,
	})
	if err != nil {
		return fmt.Errorf("failed to query workflow definitions: %w", err)
	}

	// Start new workflow instances
	for _, def := range definitions {
		if def.Trigger != nil && def.Trigger.Event == event.Type && e.evaluateConditions(event.Payload, def.Trigger.Condition) {
			if err := e.startWorkflow(ctx, def, event); err != nil {
				e.config.Logger.Error("failed to start workflow", "error", err, "definitionID", def.ID)
				continue
			}
		}
	}

	// Signal waiting workflows
	e.signalWaitingWorkflows(event)

	return nil
}

// RegisterActivity registers a custom activity with the engine
func (e *Engine) RegisterActivity(name string, activity core.ActivityFunc) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	e.activities[name] = activity
	e.config.Logger.Info("Registered activity", "name", name)
	return nil
}

// GetState returns the current state of the workflow engine
func (e *Engine) GetState() interface{} {
	e.mu.RLock()
	defer e.mu.RUnlock()

	return &EngineState{
		RunningWorkflows:   e.state.RunningWorkflows,
		CompletedWorkflows: e.state.CompletedWorkflows,
		FailedWorkflows:    e.state.FailedWorkflows,
		WaitingWorkflows:   e.state.WaitingWorkflows,
		StartedAt:          e.state.StartedAt,
	}
}

// IsHealthy returns true if the engine is running and healthy
func (e *Engine) IsHealthy() bool {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.running
}

// startWorkflow creates and starts a new workflow instance
func (e *Engine) startWorkflow(ctx context.Context, definition *core.WorkflowDefinition, triggerEvent *core.Event) error {
	workflowID := fmt.Sprintf("%s-%d", definition.ID, time.Now().UnixNano())

	instance := &WorkflowInstance{
		ID:           workflowID,
		DefinitionID: definition.ID,
		Definition:   definition,
		Context: &WorkflowContext{
			TriggeredBy:  triggerEvent,
			Variables:    make(map[string]any),
			Aggregations: make(map[string]any),
			StepResults:  make(map[string]any),
			Logger:       e.config.Logger,
		},
		State:     StateRunning,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}

	e.mu.Lock()
	e.workflows[workflowID] = instance
	e.state.RunningWorkflows++
	e.mu.Unlock()

	// Queue for execution
	select {
	case e.workflowChan <- instance:
		e.config.Logger.Info("Started workflow", "workflowID", workflowID, "definitionID", definition.ID)
		return nil
	default:
		// Channel full, reject workflow
		e.mu.Lock()
		delete(e.workflows, workflowID)
		e.state.RunningWorkflows--
		e.mu.Unlock()
		return fmt.Errorf("workflow queue full, unable to start workflow %s", workflowID)
	}
}

// workflowWorker processes workflow instances
func (e *Engine) workflowWorker() {
	for instance := range e.workflowChan {
		if e.ctx.Err() != nil {
			return
		}

		e.executeWorkflow(instance)
	}
}

// executeWorkflow executes a workflow instance
func (e *Engine) executeWorkflow(instance *WorkflowInstance) {
	defer func() {
		if r := recover(); r != nil {
			e.config.Logger.Error("Workflow panic", "workflowID", instance.ID, "panic", r)
			e.completeWorkflow(instance, fmt.Errorf("workflow panicked: %v", r))
		}
	}()

	ctx, cancel := context.WithTimeout(e.ctx, time.Duration(e.config.WorkflowTimeout)*time.Second)
	defer cancel()

	if err := e.runWorkflowSteps(ctx, instance); err != nil {
		e.completeWorkflow(instance, err)
	} else {
		e.completeWorkflow(instance, nil)
	}
}

// runWorkflowSteps executes the workflow steps
func (e *Engine) runWorkflowSteps(ctx context.Context, instance *WorkflowInstance) error {
	// Build dependency graph
	dependencyGraph := e.buildDependencyGraph(instance.Definition.Steps)
	completedSteps := make(map[string]bool)

	// Continue until all steps are completed
	for len(completedSteps) < len(instance.Definition.Steps) {
		// Find executable steps
		executableSteps := e.findExecutableSteps(instance.Definition.Steps, dependencyGraph, completedSteps)

		if len(executableSteps) == 0 && len(completedSteps) < len(instance.Definition.Steps) {
			return fmt.Errorf("deadlock detected in workflow execution: circular dependency")
		}

		// Execute steps
		for _, step := range executableSteps {
			if ctx.Err() != nil {
				return ctx.Err()
			}

			stepResult := make(map[string]any)
			if err := e.executeStep(ctx, instance, step, &stepResult); err != nil {
				return fmt.Errorf("failed to execute step %s: %w", step.ID, err)
			}

			// Store step result
			instance.Context.StepResults[step.ID] = stepResult
			completedSteps[step.ID] = true

			// Handle exports
			if step.Exports != nil {
				for exportKey, exportValue := range step.Exports {
					resolvedValue, err := e.resolveParameterReference(exportValue, instance.Context)
					if err != nil {
						return fmt.Errorf("failed to resolve export %s: %w", exportKey, err)
					}
					instance.Context.Variables[exportKey] = resolvedValue
				}
			}
		}
	}

	return nil
}

// registerBuiltinActivities registers the built-in activities
func (e *Engine) registerBuiltinActivities() {
	// These would normally be imported from activities package
	e.activities["fetch_workflow_definition"] = e.fetchWorkflowDefinitionActivity
	e.activities["register_waiting_workflow"] = e.registerWaitingWorkflowActivity
	e.activities["update_workflow_state"] = e.updateWorkflowStateActivity
}

// signalWaitingWorkflows signals workflows waiting for the given event
func (e *Engine) signalWaitingWorkflows(event *core.Event) {
	e.mu.RLock()
	waitingWorkflowIDs, exists := e.waitingList[event.Type]
	if !exists || len(waitingWorkflowIDs) == 0 {
		e.mu.RUnlock()
		return
	}

	// Copy the list to avoid holding the lock
	workflowIDs := make([]string, len(waitingWorkflowIDs))
	copy(workflowIDs, waitingWorkflowIDs)
	e.mu.RUnlock()

	for _, workflowID := range workflowIDs {
		e.mu.RLock()
		instance, exists := e.workflows[workflowID]
		e.mu.RUnlock()

		if exists && instance.State == StateWaiting {
			// Resume workflow with the event
			instance.mu.Lock()
			instance.State = StateRunning
			instance.mu.Unlock()

			// Queue for continued execution
			select {
			case e.workflowChan <- instance:
				e.config.Logger.Info("Resumed waiting workflow", "workflowID", workflowID, "eventType", event.Type)
			default:
				e.config.Logger.Warn("Failed to resume workflow, queue full", "workflowID", workflowID)
			}
		}
	}
}

// completeWorkflow marks a workflow as completed or failed
func (e *Engine) completeWorkflow(instance *WorkflowInstance, err error) {
	instance.mu.Lock()
	instance.UpdatedAt = time.Now()
	now := time.Now()
	instance.CompletedAt = &now

	if err != nil {
		instance.State = StateFailed
		instance.Error = err
		e.config.Logger.Error("Workflow failed", "workflowID", instance.ID, "error", err)
	} else {
		instance.State = StateCompleted
		e.config.Logger.Info("Workflow completed", "workflowID", instance.ID)
	}
	instance.mu.Unlock()

	e.mu.Lock()
	e.state.RunningWorkflows--
	if err != nil {
		e.state.FailedWorkflows++
	} else {
		e.state.CompletedWorkflows++
	}
	e.mu.Unlock()
}
