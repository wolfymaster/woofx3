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
	engine  *engine.Engine[Services]
	logger  tasks.Logger
	manager *WorkflowManager
}

func NewWorkflowApp(logger tasks.Logger, dbClient dbv1.WorkflowService) *WorkflowApp {
	engine := engine.New[Services](logger)
	app := &WorkflowApp{
		BaseApplication: runtime.NewBaseApplication(),
		engine:          engine,
		logger:          logger,
	}

	// Create manager with app's engine as the registry (engine implements WorkflowRegistry interface)
	// dbClient can be nil if not configured
	app.manager = NewWorkflowManager(logger, app.engine, dbClient)

	return app
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

					if err := a.subscribeToWorkflowEvents(natsClient, string(cloudevents.SubjectWorkflowChange)); err != nil {
						a.logger.Error("Failed to subscribe to workflow events", "error", err)
					}
				}
			}
		}
	}

	// Register barkloader action
	a.engine.RegisterAction("function", NewBarkloaderAction())

	// Register print action for debugging
	a.engine.RegisterAction("print", func(ctx tasks.ActionContext[Services], params map[string]interface{}) (map[string]interface{}, error) {
		a.logger.Info("Action: print", "params", params)
		return params, nil
	})

	return a.engine.Start(ctx)
}

func (a *WorkflowApp) Terminate(ctx context.Context) error {
	a.logger.Info("Terminating workflow application")

	return a.engine.Stop()
}

func (a *WorkflowApp) Engine() *engine.Engine[Services] {
	return a.engine
}
