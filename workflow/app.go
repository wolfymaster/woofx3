package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"

	cloudevents "github.com/cloudevents/sdk-go/v2"
	"github.com/wolfymaster/woofx3/clients/barkloader"
	dbv1 "github.com/wolfymaster/woofx3/clients/db"
	natsclient "github.com/wolfymaster/woofx3/clients/nats"
	"github.com/wolfymaster/woofx3/common/runtime"
	"github.com/wolfymaster/woofx3/workflow/internal/engine"
	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// NATSEventPublisher implements engine.EventPublisher using NATS
type NATSEventPublisher struct {
	client *natsclient.Client
	logger tasks.Logger
}

func NewNATSEventPublisher(client *natsclient.Client, logger tasks.Logger) *NATSEventPublisher {
	return &NATSEventPublisher{
		client: client,
		logger: logger,
	}
}

func (p *NATSEventPublisher) Publish(event *types.Event) error {
	if p.client == nil {
		return fmt.Errorf("NATS client not available")
	}

	data, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("failed to marshal event: %w", err)
	}

	// Use event type as subject, replacing dots with periods is standard
	subject := event.Type
	if event.Subject != "" {
		subject = event.Subject
	}

	p.logger.Info("Publishing event to NATS", "type", event.Type, "subject", subject, "id", event.ID)

	return p.client.Publish(subject, data)
}

// Services defines the available services for actions
type Services struct {
	Barkloader func() *barkloader.Client // Returns the barkloader client or nil if not registered
	MessageBus func() *natsclient.Client // Returns the message bus client or nil if not registered
}

type WorkflowApp struct {
	*runtime.BaseApplication
	engine *engine.Engine[Services]
	logger tasks.Logger
}

func NewWorkflowApp(logger tasks.Logger) *WorkflowApp {
	return &WorkflowApp{
		BaseApplication: runtime.NewBaseApplication(),
		engine:          engine.New[Services](logger),
		logger:          logger,
	}
}

func (a *WorkflowApp) Init(ctx context.Context) error {
	a.logger.Info("Initializing workflow application")

	// Load workflows from database
	if err := a.loadWorkflowsFromDB(ctx); err != nil {
		a.logger.Error("Failed to load workflows from database", "error", err)
		// Don't fail initialization if workflow loading fails - continue with existing workflows
	}

	return nil
}

func (a *WorkflowApp) loadWorkflowsFromDB(ctx context.Context) error {
	dbURL := os.Getenv("DATABASE_PROXY_URL")
	if dbURL == "" {
		a.logger.Warn("DATABASE_PROXY_URL not set, skipping workflow loading from database")
		return nil
	}

	// Create DB client
	httpClient := &http.Client{}
	workflowClient := dbv1.NewWorkflowServiceProtobufClient(dbURL, httpClient)

	// Fetch all enabled workflows
	req := &dbv1.ListWorkflowsRequest{
		IncludeDisabled: false,
		PageSize:        1000, // Fetch a large batch
	}

	resp, err := workflowClient.ListWorkflows(ctx, req)
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
			a.logger.Error("Failed to convert workflow", "workflow_id", dbWorkflow.GetId(), "error", err)
			continue
		}

		if err := a.engine.RegisterWorkflow(workflowDef); err != nil {
			a.logger.Error("Failed to register workflow", "workflow_id", workflowDef.ID, "error", err)
			continue
		}

		loadedCount++
		a.logger.Info("Loaded workflow from database", "workflow_id", workflowDef.ID, "name", workflowDef.Name)
	}

	a.logger.Info("Loaded workflows from database", "count", loadedCount)
	return nil
}

// DBWorkflowEvent represents the workflow data structure from the DB proxy events
type DBWorkflowEvent struct {
	ID            string `json:"ID"`
	ApplicationID string `json:"ApplicationID"`
	Name          string `json:"Name"`
	Steps         string `json:"Steps"`
	Trigger       string `json:"Trigger"`
}

// subscribeToWorkflowEvents subscribes to workflow CRUD events from the DB proxy
func (a *WorkflowApp) subscribeToWorkflowEvents(natsClient *natsclient.Client) error {
	// Subscribe to all workflow events using wildcard
	// Subject format: db.workflow.<operation>.<application_id>
	_, err := natsClient.Subscribe("db.workflow.>", func(msg natsclient.Msg) {
		a.handleWorkflowEvent(msg)
	})
	if err != nil {
		return fmt.Errorf("failed to subscribe to workflow events: %w", err)
	}

	a.logger.Info("Subscribed to workflow events", "subject", "db.workflow.>")
	return nil
}

// handleWorkflowEvent processes incoming workflow CRUD events
func (a *WorkflowApp) handleWorkflowEvent(msg natsclient.Msg) {
	// Parse the CloudEvent
	var ce cloudevents.Event
	if err := json.Unmarshal(msg.Data(), &ce); err != nil {
		a.logger.Error("Failed to parse CloudEvent", "error", err, "subject", msg.Subject())
		return
	}

	// Extract operation from CloudEvent extensions
	operation, ok := ce.Extensions()["operation"].(string)
	if !ok {
		a.logger.Error("Missing operation in CloudEvent", "subject", msg.Subject())
		return
	}

	entityID, _ := ce.Extensions()["entity_id"].(string)

	a.logger.Info("Received workflow event", "operation", operation, "entity_id", entityID, "type", ce.Type())

	switch operation {
	case "created", "updated":
		a.handleWorkflowCreateOrUpdate(&ce, entityID)
	case "deleted":
		a.handleWorkflowDelete(entityID)
	default:
		a.logger.Warn("Unknown workflow operation", "operation", operation)
	}
}

// handleWorkflowCreateOrUpdate registers or updates a workflow in memory
func (a *WorkflowApp) handleWorkflowCreateOrUpdate(ce *cloudevents.Event, entityID string) {
	// Parse the workflow data from CloudEvent
	var dbWorkflow DBWorkflowEvent
	if err := ce.DataAs(&dbWorkflow); err != nil {
		a.logger.Error("Failed to parse workflow data", "error", err, "entity_id", entityID)
		return
	}

	// Convert to engine workflow definition
	workflowDef, err := a.convertEventWorkflowToEngineWorkflow(&dbWorkflow)
	if err != nil {
		a.logger.Error("Failed to convert workflow", "error", err, "entity_id", entityID)
		return
	}

	// Register the workflow (this will overwrite if it already exists)
	if err := a.engine.RegisterWorkflow(workflowDef); err != nil {
		a.logger.Error("Failed to register workflow", "error", err, "workflow_id", workflowDef.ID)
		return
	}

	a.logger.Info("Workflow registered from event", "workflow_id", workflowDef.ID, "name", workflowDef.Name)
}

// handleWorkflowDelete removes a workflow from memory
func (a *WorkflowApp) handleWorkflowDelete(entityID string) {
	if entityID == "" {
		a.logger.Error("Missing entity_id for workflow delete")
		return
	}

	if err := a.engine.UnregisterWorkflow(entityID); err != nil {
		a.logger.Warn("Failed to unregister workflow", "error", err, "workflow_id", entityID)
		return
	}

	a.logger.Info("Workflow unregistered from event", "workflow_id", entityID)
}

// convertEventWorkflowToEngineWorkflow converts a DB workflow event to an engine workflow definition
func (a *WorkflowApp) convertEventWorkflowToEngineWorkflow(dbWorkflow *DBWorkflowEvent) (*types.WorkflowDefinition, error) {
	// Parse steps from JSON
	var steps []types.TaskDefinition
	if dbWorkflow.Steps != "" {
		// The Steps field may be in the DB workflow step format, need to convert
		var dbSteps []dbv1.WorkflowStep
		if err := json.Unmarshal([]byte(dbWorkflow.Steps), &dbSteps); err != nil {
			// Try parsing as raw task definitions
			if err := json.Unmarshal([]byte(dbWorkflow.Steps), &steps); err != nil {
				return nil, fmt.Errorf("failed to parse steps: %w", err)
			}
		} else {
			// Convert DB steps to task definitions
			for _, dbStep := range dbSteps {
				task, err := convertDBStepToTask(&dbStep)
				if err != nil {
					return nil, fmt.Errorf("failed to convert step %s: %w", dbStep.GetId(), err)
				}
				steps = append(steps, *task)
			}
		}
	}

	// Parse trigger from JSON
	var trigger *types.TriggerConfig
	if dbWorkflow.Trigger != "" && dbWorkflow.Trigger != "{}" {
		if err := json.Unmarshal([]byte(dbWorkflow.Trigger), &trigger); err != nil {
			a.logger.Warn("Failed to parse trigger", "error", err, "workflow_id", dbWorkflow.ID)
			// Continue without trigger
		}
	}

	workflowDef := &types.WorkflowDefinition{
		ID:      dbWorkflow.ID,
		Name:    dbWorkflow.Name,
		Tasks:   steps,
		Trigger: trigger,
	}

	return workflowDef, nil
}

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

func convertDBStepToTask(dbStep *dbv1.WorkflowStep) (*types.TaskDefinition, error) {
	// Convert parameters from map[string]string to map[string]interface{}
	parameters := make(map[string]interface{})
	for k, v := range dbStep.GetParameters() {
		// Try to parse JSON values if they're JSON strings
		var jsonValue interface{}
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

func (a *WorkflowApp) Run(ctx context.Context) error {
	a.logger.Info("Running workflow application")

	// Set up services builder for engine
	a.engine.SetServices(func(appContext interface{}) Services {
		ctx, ok := appContext.(*runtime.ApplicationContext)
		if !ok {
			return Services{}
		}

		var barkloaderClient func() *barkloader.Client
		if svc, ok := ctx.GetService("barkloader"); ok {
			barkloaderClient = func() *barkloader.Client {
				if client := svc.Client(); client != nil {
					if bc, ok := client.(*barkloader.Client); ok {
						return bc
					}
				}
				return nil
			}
		}

		var messageBusClient func() *natsclient.Client
		if svc, ok := ctx.GetService("messageBus"); ok {
			messageBusClient = func() *natsclient.Client {
				return svc.Client().(*natsclient.Client)
			}
		}

		return Services{
			Barkloader: barkloaderClient,
			MessageBus: messageBusClient,
		}
	}, a.Context())

	// Set up event publisher and subscribe to workflow events using NATS
	if appCtx := a.Context(); appCtx != nil {
		if svc, ok := appCtx.GetService("messageBus"); ok {
			if client := svc.Client(); client != nil {
				if natsClient, ok := client.(*natsclient.Client); ok {
					publisher := NewNATSEventPublisher(natsClient, a.logger)
					a.engine.SetPublisher(publisher)
					a.logger.Info("Event publisher configured with NATS")

					// Subscribe to workflow CRUD events from DB proxy
					if err := a.subscribeToWorkflowEvents(natsClient); err != nil {
						a.logger.Error("Failed to subscribe to workflow events", "error", err)
					}
				}
			}
		}
	}

	// Register barkloader action
	a.engine.RegisterAction("barkloader", NewBarkloaderAction())

	a.engine.RegisterAction("print", func(ctx tasks.ActionContext[Services], params map[string]interface{}) (map[string]interface{}, error) {
		a.logger.Info("Action: print", "params", params)
		return params, nil
	})

	// Child workflow: VIP special effects (triggered by parent workflow)
	vipEffectsWorkflow := &types.WorkflowDefinition{
		ID:   "vip-special-effects",
		Name: "VIP Special Effects",
		Trigger: &types.TriggerConfig{
			Type:      "event",
			EventType: "workflow.vip-effects",
		},
		Tasks: []types.TaskDefinition{
			{
				ID:   "play-sound",
				Type: "action",
				Parameters: map[string]interface{}{
					"action":  "print",
					"message": "Playing VIP sound effect for ${trigger.data.user_name}",
				},
			},
			{
				ID:        "show-animation",
				Type:      "action",
				DependsOn: []string{"play-sound"},
				Parameters: map[string]interface{}{
					"action":  "print",
					"message": "Showing VIP animation for ${trigger.data.user_name}",
				},
			},
			{
				ID:        "send-notification",
				Type:      "action",
				DependsOn: []string{"show-animation"},
				Parameters: map[string]interface{}{
					"action":  "print",
					"message": "Sending VIP notification to mods about ${trigger.data.user_name}",
				},
			},
		},
	}

	if err := a.engine.RegisterWorkflow(vipEffectsWorkflow); err != nil {
		return err
	}

	// Parent workflow: Follow alert that triggers sub-workflow for VIPs
	followWorkflow := &types.WorkflowDefinition{
		ID:   "follow-alert",
		Name: "Follow Alert with Sub-workflow",
		Trigger: &types.TriggerConfig{
			Type:      "event",
			EventType: "follow.user.twitch",
		},
		Tasks: []types.TaskDefinition{
			{
				ID:   "log-follow",
				Type: "log",
				Parameters: map[string]interface{}{
					"message": "New follower: ${trigger.data.user_name}",
				},
			},
			{
				ID:        "standard-alert",
				Type:      "action",
				DependsOn: []string{"log-follow"},
				Parameters: map[string]interface{}{
					"action":  "print",
					"message": "Welcome ${trigger.data.user_name}!",
				},
			},
			{
				// Trigger VIP special effects workflow (only if VIP)
				ID:        "trigger-vip-effects",
				Type:      "workflow",
				DependsOn: []string{"standard-alert"},
				Condition: &types.ConditionConfig{
					Field:    "${trigger.data.is_vip}",
					Operator: "eq",
					Value:    true,
				},
				Workflow: &types.WorkflowConfig{
					WorkflowID:          "vip-special-effects",
					WaitUntilCompletion: true,
					EventType:           "workflow.vip-effects",
					EventData: map[string]interface{}{
						"user_name": "${trigger.data.user_name}",
						"is_vip":    "${trigger.data.is_vip}",
					},
				},
			},
			{
				ID:        "final-log",
				Type:      "log",
				DependsOn: []string{"trigger-vip-effects"},
				Parameters: map[string]interface{}{
					"message": "Follow alert processing complete for ${trigger.data.user_name}",
				},
			},
		},
	}

	if err := a.engine.RegisterWorkflow(followWorkflow); err != nil {
		return err
	}

	// Donation workflow demonstrating between operator and multiple conditions
	donationWorkflow := &types.WorkflowDefinition{
		ID:   "donation-alert",
		Name: "Donation Alert with Tiers",
		Trigger: &types.TriggerConfig{
			Type:      "event",
			EventType: "donation.received",
		},
		Tasks: []types.TaskDefinition{
			{
				ID:   "log-donation",
				Type: "log",
				Parameters: map[string]interface{}{
					"message": "Donation received: $${trigger.data.amount} from ${trigger.data.donor_name}",
				},
			},
			{
				// Check for mega donation: amount >= 100 AND is_first_time = true
				ID:        "check-mega-donation",
				Type:      "condition",
				DependsOn: []string{"log-donation"},
				Conditions: []types.ConditionConfig{
					{
						Field:    "${trigger.data.amount}",
						Operator: "gte",
						Value:    100,
					},
					{
						Field:    "${trigger.data.is_first_time}",
						Operator: "eq",
						Value:    true,
					},
				},
				ConditionLogic: "and", // Both conditions must be true
				OnTrue:         []string{"mega-alert"},
				OnFalse:        []string{"check-tier"},
			},
			{
				ID:        "mega-alert",
				Type:      "action",
				DependsOn: []string{"check-mega-donation"},
				Parameters: map[string]interface{}{
					"action":  "print",
					"message": "MEGA FIRST-TIME DONATION! $${trigger.data.amount} from ${trigger.data.donor_name}!",
				},
			},
			{
				// Check tier using between operator: mid-tier is $10-$49
				ID:        "check-tier",
				Type:      "condition",
				DependsOn: []string{"check-mega-donation"},
				Condition: &types.ConditionConfig{
					Field:    "${trigger.data.amount}",
					Operator: "between",
					Value:    []interface{}{10, 49},
				},
				OnTrue:  []string{"mid-tier-alert"},
				OnFalse: []string{"check-high-or-small"},
			},
			{
				ID:        "mid-tier-alert",
				Type:      "action",
				DependsOn: []string{"check-tier"},
				Parameters: map[string]interface{}{
					"action":  "print",
					"message": "Mid-tier donation: $${trigger.data.amount} from ${trigger.data.donor_name}",
				},
			},
			{
				// Check if high tier (>=50) OR has custom message (either triggers special handling)
				ID:        "check-high-or-small",
				Type:      "condition",
				DependsOn: []string{"check-tier"},
				Conditions: []types.ConditionConfig{
					{
						Field:    "${trigger.data.amount}",
						Operator: "gte",
						Value:    50,
					},
					{
						Field:    "${trigger.data.has_message}",
						Operator: "eq",
						Value:    true,
					},
				},
				ConditionLogic: "or", // Either condition triggers special alert
				OnTrue:         []string{"special-alert"},
				OnFalse:        []string{"small-alert"},
			},
			{
				ID:        "special-alert",
				Type:      "action",
				DependsOn: []string{"check-high-or-small"},
				Parameters: map[string]interface{}{
					"action":  "print",
					"message": "SPECIAL donation alert: $${trigger.data.amount} from ${trigger.data.donor_name}!",
				},
			},
			{
				ID:        "small-alert",
				Type:      "action",
				DependsOn: []string{"check-high-or-small"},
				Parameters: map[string]interface{}{
					"action":  "print",
					"message": "Thank you for the $${trigger.data.amount} donation, ${trigger.data.donor_name}!",
				},
			},
		},
	}

	if err := a.engine.RegisterWorkflow(donationWorkflow); err != nil {
		return err
	}

	a.logger.Info("Registered workflows: vip-special-effects, follow-alert, donation-alert")

	return a.engine.Start(ctx)
}

func (a *WorkflowApp) Terminate(ctx context.Context) error {
	a.logger.Info("Terminating workflow application")

	return a.engine.Stop()
}

func (a *WorkflowApp) Engine() *engine.Engine[Services] {
	return a.engine
}
