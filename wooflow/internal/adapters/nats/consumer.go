package natsconsumer

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"

	"github.com/nats-io/nats.go"
	"github.com/wolfymaster/woofx3/workflow/internal/core"
	"github.com/wolfymaster/woofx3/workflow/internal/ports"
	"github.com/wolfymaster/woofx3/workflow/internal/workflow/temporal"
)

// SubscriptionConfig defines the configuration for a NATS subscription
type SubscriptionConfig struct {
	Subject string
	Handler func(*nats.Msg)
}

// Consumer represents a NATS consumer
type Consumer struct {
	nc             *nats.Conn
	eventRepo      ports.EventRepository
	workflowRepo   ports.WorkflowDefinitionRepository
	logger         *slog.Logger
	configs        []SubscriptionConfig
	temporalClient *temporal.Client
}

// NewConsumer creates a new NATS consumer
func NewConsumer(
	nc *nats.Conn,
	eventRepo ports.EventRepository,
	workflowRepo ports.WorkflowDefinitionRepository,
	logger *slog.Logger,
	configs []SubscriptionConfig,
) *Consumer {
	return &Consumer{
		nc:           nc,
		eventRepo:    eventRepo,
		workflowRepo: workflowRepo,
		logger:       logger,
		configs:      configs,
	}
}

// SetTemporalClient sets the Temporal client for workflow execution
func (c *Consumer) SetTemporalClient(client *temporal.Client) {
	c.temporalClient = client
}

// Start starts the consumer
func (c *Consumer) Start(ctx context.Context) error {
	// Subscribe to each subject
	for _, config := range c.configs {
		sub, err := c.nc.Subscribe(config.Subject, func(msg *nats.Msg) {
			// Extract event type from subject
			parts := strings.Split(msg.Subject, ".")
			if len(parts) != 2 {
				c.logger.Error("invalid subject format", "subject", msg.Subject)
				return
			}
			eventType := parts[1]

			// Create event
			event := &core.Event{
				ID:      msg.Header.Get("event_id"),
				Type:    eventType,
				Payload: make(map[string]interface{}),
			}

			// Parse payload
			if err := json.Unmarshal(msg.Data, &event.Payload); err != nil {
				c.logger.Error("failed to parse event payload", "error", err, "data", string(msg.Data))
				return
			}

			// Store event
			if err := c.eventRepo.StoreEvent(ctx, event); err != nil {
				c.logger.Error("failed to store event", "error", err)
				return
			}

			// Find workflows that should be triggered by this event
			definitions, err := c.workflowRepo.QueryWorkflowDefinitions(ctx, &core.WorkflowDefinitionFilter{
				TriggerEvent: eventType,
				Limit:        100,
			})
			if err != nil {
				c.logger.Error("failed to query workflow definitions", "error", err)
				return
			}

			// Start new workflows
			for _, def := range definitions {
				if def.Trigger != nil && def.Trigger.Event == eventType {
					if c.temporalClient == nil {
						c.logger.Error("temporal client not set")
						continue
					}

					if err := c.temporalClient.HandleEvent(ctx, event); err != nil {
						c.logger.Error("failed to handle event", "error", err, "workflow_id", def.ID)
						continue
					}
				}
			}

			// Call the original handler if provided
			if config.Handler != nil {
				config.Handler(msg)
			}
		})
		if err != nil {
			return fmt.Errorf("failed to subscribe to %s: %w", config.Subject, err)
		}

		// Set up auto-unsubscribe on context cancellation
		go func() {
			<-ctx.Done()
			if err := sub.Unsubscribe(); err != nil {
				c.logger.Error("failed to unsubscribe", "error", err, "subject", config.Subject)
			}
		}()
	}

	return nil
}
