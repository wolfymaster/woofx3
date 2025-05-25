package temporal

import (
	"context"
	"fmt"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/wolfymaster/woofx3/wooflow/internal/core"
	"github.com/wolfymaster/woofx3/wooflow/internal/ports"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/log"
	"go.temporal.io/sdk/worker"
)

// Client represents a Temporal client
type Client struct {
	client       client.Client
	worker       worker.Worker
	eventRepo    core.EventRepository
	workflowRepo ports.WorkflowDefinitionRepository
	state        *WorkflowState
	taskQueue    string
	nc           *nats.Conn
	activities   map[string]func(context.Context, map[string]any) (ExecuteActionResult, error)
	logger       log.Logger
}

// NewClient creates a new Temporal client
func NewClient(
	host string,
	namespace string,
	taskQueue string,
	eventRepo core.EventRepository,
	workflowRepo ports.WorkflowDefinitionRepository,
	nc *nats.Conn,
	logger log.Logger,
) (*Client, error) {
	// Create Temporal client
	c, err := client.Dial(client.Options{
		HostPort:  host,
		Namespace: namespace,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create Temporal client: %w", err)
	}

	// Create workflow state
	state := NewWorkflowState()

	// Create worker
	w := worker.New(c, taskQueue, worker.Options{})

	// Create client instance
	client := &Client{
		client:       c,
		worker:       w,
		eventRepo:    eventRepo,
		workflowRepo: workflowRepo,
		state:        state,
		taskQueue:    taskQueue,
		nc:           nc,
		activities:   make(map[string]func(context.Context, map[string]any) (ExecuteActionResult, error)),
		logger:       logger,
	}

	// Set global client instance
	SetGlobalClient(client)

	// Register workflow
	w.RegisterWorkflow(DynamicWorkflow)

	// Register activities
	w.RegisterActivity(FetchWorkflowDefinition)
	w.RegisterActivity(UpdateWorkflowState)
	w.RegisterActivity(ExecuteAction)
	w.RegisterActivity(RegisterWaitingWorkflow)
	w.RegisterActivity(RemoveWaitingWorkflow)

	// Start worker
	if err := w.Start(); err != nil {
		return nil, fmt.Errorf("failed to start worker: %w", err)
	}

	return client, nil
}

// RegisterActivity registers a new activity function
func (c *Client) RegisterActivity(name string, fn func(context.Context, map[string]any) (ExecuteActionResult, error)) {
	c.activities[name] = fn
}

// HandleEvent handles a new event by starting workflows and signaling waiting workflows
func (c *Client) HandleEvent(ctx context.Context, event *core.Event) error {
	// 1. Store event
	if err := c.eventRepo.StoreEvent(ctx, event); err != nil {
		return fmt.Errorf("failed to store event: %w", err)
	}

	// 2. Find workflows that should be triggered by this event
	definitions, err := c.workflowRepo.QueryWorkflowDefinitions(ctx, &core.WorkflowDefinitionFilter{
		TriggerEvent: event.Type,
		Limit:        100,
	})
	if err != nil {
		return fmt.Errorf("failed to query workflow definitions: %w", err)
	}

	// 3. Start new workflow instances
	for _, def := range definitions {
		if def.Trigger != nil && def.Trigger.Event == event.Type && EvaluateConditions(event.Payload, def.Trigger.Condition) {
			// Start workflow
			workflowID := fmt.Sprintf("%s-%s", def.ID, event.ID)
			_, err := c.client.ExecuteWorkflow(
				ctx,
				client.StartWorkflowOptions{
					ID:        workflowID,
					TaskQueue: "workflow",
				},
				DynamicWorkflow,
				DynamicWorkflowInput{
					WorkflowDefID: def.ID,
					TriggerEvent:  event,
				},
			)
			if err != nil {
				return fmt.Errorf("failed to start workflow: %w", err)
			}
		}
	}

	// 4. Signal waiting workflows
	waitingWorkflows := c.state.GetWaitingWorkflows(event.Type)
	for _, workflowID := range waitingWorkflows {
		if err := c.client.SignalWorkflow(ctx, workflowID, "", event.Type, event); err != nil {
			// log that we couldn't send the signal, log the error
			c.logger.Error("failed to signal workflow", "workflowId", workflowID, "error", err)
			// remove workfow from waiting
			c.state.RemoveWaitingWorkflow(event.Type, workflowID)
		}
	}

	return nil
}

// Close closes the Temporal client
func (c *Client) Close() {
	if c.worker != nil {
		c.worker.Stop()
	}
	if c.client != nil {
		c.client.Close()
	}
}

// StartWorkflow starts a new workflow execution
func (c *Client) StartWorkflow(ctx context.Context, workflowDefID string, triggerEvent *core.Event) (string, error) {
	// Start workflow
	workflowOptions := client.StartWorkflowOptions{
		ID:        fmt.Sprintf("workflow-%s-%d", workflowDefID, time.Now().UnixNano()),
		TaskQueue: c.taskQueue,
	}

	// Create workflow input
	input := DynamicWorkflowInput{
		WorkflowDefID: workflowDefID,
		TriggerEvent:  triggerEvent,
	}

	// Start workflow
	execution, err := c.client.ExecuteWorkflow(ctx, workflowOptions, DynamicWorkflow, input)
	if err != nil {
		return "", fmt.Errorf("failed to start workflow: %w", err)
	}

	return execution.GetID(), nil
}
