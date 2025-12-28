package main

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/wolfymaster/woofx3/clients/barkloader"
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
	return nil
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

	// Set up event publisher using NATS
	if appCtx := a.Context(); appCtx != nil {
		if svc, ok := appCtx.GetService("messageBus"); ok {
			if client := svc.Client(); client != nil {
				if natsClient, ok := client.(*natsclient.Client); ok {
					publisher := NewNATSEventPublisher(natsClient, a.logger)
					a.engine.SetPublisher(publisher)
					a.logger.Info("Event publisher configured with NATS")
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
