package main

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/wolfymaster/woofx3/clients/barkloader"
	dbv1 "github.com/wolfymaster/woofx3/clients/db"
	natsclient "github.com/wolfymaster/woofx3/clients/nats"
	"github.com/wolfymaster/woofx3/common/cloudevents"
	"github.com/wolfymaster/woofx3/common/runtime"
	"github.com/wolfymaster/woofx3/workflow/internal/engine"
	"github.com/wolfymaster/woofx3/workflow/internal/eventmatch"
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

type WorkflowApp struct {
	*runtime.BaseApplication
	engine         *engine.Engine[AppServices]
	logger         tasks.Logger
	manager        *WorkflowManager
	moduleDbClient dbv1.ModuleService
}

func NewWorkflowApp(logger tasks.Logger) *WorkflowApp {
	engine := engine.New[AppServices](logger)
	app := &WorkflowApp{
		BaseApplication: runtime.NewBaseApplication(),
		engine:          engine,
		logger:          logger,
	}

	// Create manager without a db client; SetDbClients wires it after config is loaded.
	app.manager = NewWorkflowManager(logger, app.engine, nil)

	return app
}

func (a *WorkflowApp) SetDbClients(workflowClient dbv1.WorkflowService, moduleClient dbv1.ModuleService) {
	a.moduleDbClient = moduleClient
	a.manager.SetDbClient(workflowClient)
}

func (a *WorkflowApp) Init(ctx context.Context) error {
	a.logger.Info("Initializing workflow application")

	// Load workflows from database
	if err := a.manager.LoadWorkflowsFromDB(ctx); err != nil {
		a.logger.Error("Failed to load workflows from database", "error", err)
		// Don't fail initialization if workflow loading fails - continue with existing workflows
	}

	return nil
}

func (a *WorkflowApp) Run(ctx context.Context) error {
	a.logger.Info("Running workflow application")

	appCtx := a.Context()
	if appCtx != nil {
		if svc, ok := runtime.GetServiceTyped[*barkloader.Client](appCtx, "barkloader"); ok {
			registerService("barkloader", func() *barkloader.Client {
				return svc.Client()
			})
		}

		if svc, ok := runtime.GetServiceTyped[*natsclient.Client](appCtx, "nats"); ok {
			natsClient := svc.Client()
			registerService("messageBus", func() *natsclient.Client {
				return natsClient
			})
			publisher := NewNATSEventPublisher(natsClient, a.logger)
			a.engine.SetPublisher(publisher)
			a.logger.Info("Event publisher configured with NATS")

			// workflow change events
			if err := a.subscribeToWorkflowEvents(natsClient, string(cloudevents.SubjectWorkflowChange)); err != nil {
				a.logger.Error("Failed to subscribe to workflow events", "error", err)
			}

			// workflow execute events
			if err := a.subscribeToWorkflowEvents(natsClient, string(cloudevents.SubjectWorkflowExecute)); err != nil {
				a.logger.Error("Failed to subscribe to workflow events", "error", err)
			}

			// NEW: Subscribe to trigger events - FAIL STARTUP IF THIS FAILS
			patternRegistry := NewEventPatternRegistry()
			if err := a.subscribeToTriggerEvents(natsClient, patternRegistry.GetPatterns()); err != nil {
				a.logger.Error("Failed to subscribe to trigger events", "error", err)
				return fmt.Errorf("workflow service cannot start without trigger event subscriptions: %w", err)
			}

			if err := a.subscribeToModuleTriggerEvents(ctx, natsClient, a.moduleDbClient); err != nil {
				a.logger.Warn("Failed to subscribe to module trigger events, continuing without them", "error", err)
			}
		}
	}

	appServices := buildAppServices()

	// Register barkloader action
	a.engine.RegisterAction("function", WithServices(appServices, NewBarkloaderAction()))

	// Register print action for debugging
	a.engine.RegisterAction("print", func(ctx tasks.ActionContext[AppServices], params map[string]any) (map[string]any, error) {
		a.logger.Info("Action: print", "params", params)
		return params, nil
	})

	return a.engine.Start(ctx)
}

func (a *WorkflowApp) Terminate(ctx context.Context) error {
	a.logger.Info("Terminating workflow application")

	return a.engine.Stop()
}

func (a *WorkflowApp) Engine() *engine.Engine[AppServices] {
	return a.engine
}

// subscribeToWorkflowEvents subscribes to workflow CRUD events from the DB proxy
func (a *WorkflowApp) subscribeToWorkflowEvents(natsClient *natsclient.Client, subjectPattern string) error {
	_, err := natsClient.Subscribe(subjectPattern, func(msg natsclient.Msg) {
		a.handleWorkflowEvent(msg)
	})
	if err != nil {
		return fmt.Errorf("failed to subscribe to workflow events: %w", err)
	}

	a.logger.Info("Subscribed to workflow events", "subject", subjectPattern)
	return nil
}

// handleWorkflowEvent processes incoming workflow change events
func (a *WorkflowApp) handleWorkflowEvent(msg natsclient.Msg) {
	var evt cloudevents.WorkflowChangeEvent
	err := evt.Decode(msg.Data())
	if err != nil {
		a.logger.Error("Failed to parse workflow change event", "error", err, "subject", msg.Subject())
		return
	}

	changeData, err := evt.Data()
	if err != nil {
		a.logger.Error("Failed to extract workflow change data", "error", err)
		return
	}

	a.logger.Info("Received workflow event", "operation", changeData.Operation, "entity_id", changeData.EntityID, "type", evt.Type())

	if changeData.IsCreateOrUpdate() {
		a.manager.HandleWorkflowCreateOrUpdate(&evt)
	} else if changeData.IsDeleted() {
		a.manager.HandleWorkflowDelete(changeData.EntityID)
	} else {
		a.logger.Warn("Unknown workflow operation", "operation", changeData.Operation)
	}
}

// validateCloudEvent validates that incoming data conforms to CloudEvents spec
func (a *WorkflowApp) validateCloudEvent(data []byte) (*types.Event, error) {
	var event types.Event
	if err := json.Unmarshal(data, &event); err != nil {
		return nil, fmt.Errorf("invalid JSON: %w", err)
	}

	// CloudEvents required fields validation
	if event.ID == "" {
		return nil, fmt.Errorf("event missing required field: id")
	}
	if event.Type == "" {
		return nil, fmt.Errorf("event missing required field: type")
	}
	if event.Source == "" {
		return nil, fmt.Errorf("event missing required field: source")
	}

	return &event, nil
}

// handleTriggerEvent processes incoming events that may trigger workflows
func (a *WorkflowApp) handleTriggerEvent(msg natsclient.Msg) {
	// Validate CloudEvents format
	event, err := a.validateCloudEvent(msg.Data())
	if err != nil {
		a.logger.Error("Invalid event format",
			"error", err,
			"subject", msg.Subject(),
			"raw_data", string(msg.Data()))
		return
	}

	// Debug level logging for high-frequency events
	a.logger.Debug("Received trigger event",
		"type", event.Type,
		"id", event.ID,
		"subject", msg.Subject())

	// Route to engine for workflow matching and execution
	if err := a.engine.HandleEvent(event); err != nil {
		a.logger.Error("Failed to handle trigger event",
			"error", err,
			"type", event.Type,
			"id", event.ID)
		// Continue processing other events (fail fast per event)
	}
}

// subscribeToTriggerEvents subscribes to events that can trigger workflows
func (a *WorkflowApp) subscribeToTriggerEvents(natsClient *natsclient.Client, patterns []string) error {
	for _, pattern := range patterns {
		capturedPattern := pattern // Capture for closure
		_, err := natsClient.Subscribe(pattern, func(msg natsclient.Msg) {
			a.handleTriggerEvent(msg)
		})
		if err != nil {
			return fmt.Errorf("failed to subscribe to pattern %s: %w", pattern, err)
		}
		a.logger.Info("Subscribed to trigger events", "pattern", capturedPattern)
	}
	return nil
}

// subscribeToModuleTriggerEvents fetches registered module triggers from the DB proxy
// and subscribes to any event subjects not already covered by the static pattern registry.
func (a *WorkflowApp) subscribeToModuleTriggerEvents(ctx context.Context, natsClient *natsclient.Client, moduleClient dbv1.ModuleService) error {
	if moduleClient == nil {
		a.logger.Warn("Module DB client not configured, skipping module trigger subscriptions")
		return nil
	}

	resp, err := moduleClient.ListTriggers(ctx, &dbv1.ListTriggersRequest{})
	if err != nil {
		return fmt.Errorf("failed to list module triggers: %w", err)
	}

	patternRegistry := NewEventPatternRegistry()
	coveredPatterns := patternRegistry.GetPatterns()

	subscribed := map[string]bool{}
	for _, trigger := range resp.Triggers {
		if trigger.Event == "" || subscribed[trigger.Event] {
			continue
		}
		if isEventCoveredByPatterns(trigger.Event, coveredPatterns) {
			continue
		}
		capturedEvent := trigger.Event
		_, err := natsClient.Subscribe(capturedEvent, func(msg natsclient.Msg) {
			a.handleTriggerEvent(msg)
		})
		if err != nil {
			a.logger.Error("Failed to subscribe to module trigger event", "event", capturedEvent, "error", err)
			continue
		}
		subscribed[capturedEvent] = true
		a.logger.Info("Subscribed to module trigger event", "event", capturedEvent)
	}
	return nil
}

// isEventCoveredByPatterns checks if an event subject is already covered by
// an existing NATS wildcard subscription pattern.
func isEventCoveredByPatterns(event string, patterns []string) bool {
	for _, pattern := range patterns {
		if eventmatch.Matches(pattern, event) {
			return true
		}
	}
	return false
}
