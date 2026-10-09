package workers

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/wolfymaster/woofx3/db/database/models"
	"github.com/wolfymaster/woofx3/db/database/repository"
	"gorm.io/gorm"
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

// subjectScope is the fourth token of every outbox subject.
const subjectScope = "system"

type PublishOptions struct {
	ClientID        string
	EntityType      string
	EntityID        string
	Operation       string
	Data            interface{}
	AutoAcknowledge bool
	MaxAttempts     int
}

func (p *EventPublisher) Publish(opts PublishOptions) error {
	return p.publishWith(p.repo, opts)
}

// PublishIn writes the event inside the caller's transaction `tx`, so the
// event is published if and only if the change it describes commits: the
// transactional outbox. The worker publishes it once the transaction commits.
func (p *EventPublisher) PublishIn(tx *gorm.DB, opts PublishOptions) error {
	return p.publishWith(p.repo.WithDB(tx), opts)
}

func (p *EventPublisher) publishWith(repo *repository.DbEventRepository, opts PublishOptions) error {
	p.logger.Info("creating event for publishing",
		"entity_type", opts.EntityType,
		"entity_id", opts.EntityID,
		"operation", opts.Operation,
		"auto_acknowledge", opts.AutoAcknowledge)

	payloadBytes, err := json.Marshal(opts.Data)
	if err != nil {
		p.logger.Error("failed to marshal event payload",
			"entity_type", opts.EntityType,
			"operation", opts.Operation,
			"error", err)
		return fmt.Errorf("marshal payload: %w", err)
	}

	// Subscribers match `db.<entity>.<operation>.*`, so the subject
	// carries a fixed fourth token.
	subject := fmt.Sprintf("db.%s.%s.%s",
		opts.EntityType,
		opts.Operation,
		subjectScope,
	)

	eventType := fmt.Sprintf("%s.%s", opts.EntityType, opts.Operation)

	var ackSubject *string
	if !opts.AutoAcknowledge {
		ack := fmt.Sprintf("db.ack.%s", generateUUID())
		ackSubject = &ack
	}

	event := &models.WorkerEvent{
		EventType:       eventType,
		ClientID:        opts.ClientID,
		EntityType:      opts.EntityType,
		EntityID:        opts.EntityID,
		Operation:       opts.Operation,
		Payload:         string(payloadBytes),
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

	if err := repo.Create(event); err != nil {
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
