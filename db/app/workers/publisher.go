package workers

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/wolfymaster/woofx3/db/database/models"
	"github.com/wolfymaster/woofx3/db/database/repository"
)

type EventPublisher struct {
	repo   *repository.DbEventRepository
	logger *slog.Logger
}

func NewEventPublisher(repo *repository.DbEventRepository, logger *slog.Logger) *EventPublisher {
	return &EventPublisher{
		repo:   repo,
		logger: logger,
	}
}

type PublishOptions struct {
	ApplicationID   string
	EntityType      string
	EntityID        string
	Operation       string
	Data            interface{}
	AutoAcknowledge bool
	MaxAttempts     int
}

func (p *EventPublisher) Publish(opts PublishOptions) error {
	p.logger.Info("creating event for publishing",
		"entity_type", opts.EntityType,
		"entity_id", opts.EntityID,
		"operation", opts.Operation,
		"application_id", opts.ApplicationID,
		"auto_acknowledge", opts.AutoAcknowledge)

	payloadBytes, err := json.Marshal(opts.Data)
	if err != nil {
		p.logger.Error("failed to marshal event payload",
			"entity_type", opts.EntityType,
			"operation", opts.Operation,
			"error", err)
		return fmt.Errorf("marshal payload: %w", err)
	}

	subject := fmt.Sprintf("db.%s.%s.%s",
		opts.EntityType,
		opts.Operation,
		opts.ApplicationID,
	)

	eventType := fmt.Sprintf("%s.%s", opts.EntityType, opts.Operation)

	var ackSubject *string
	if !opts.AutoAcknowledge {
		ack := fmt.Sprintf("db.ack.%s", generateUUID())
		ackSubject = &ack
	}

	event := &models.WorkerEvent{
		EventType:       eventType,
		ApplicationID:   opts.ApplicationID,
		EntityType:      opts.EntityType,
		EntityID:        opts.EntityID,
		Operation:       opts.Operation,
		Payload:         payloadBytes,
		Status:          models.WorkerEventStatusPending,
		AutoAcknowledge: opts.AutoAcknowledge,
		NATSSubject:     subject,
		AckSubject:      ackSubject,
	}

	if opts.MaxAttempts > 0 {
		event.MaxAttempts = opts.MaxAttempts
	}

	p.logger.Info("storing event in database",
		"subject", subject,
		"event_type", eventType,
		"payload_size", len(payloadBytes))

	if err := p.repo.Create(event); err != nil {
		p.logger.Error("failed to store event in database",
			"entity_type", opts.EntityType,
			"operation", opts.Operation,
			"error", err)
		return err
	}

	p.logger.Info("event stored successfully, worker will pick it up",
		"entity_type", opts.EntityType,
		"operation", opts.Operation,
		"subject", subject)

	return nil
}

func generateUUID() string {
	return fmt.Sprintf("%d", time.Now().UnixNano())
}
