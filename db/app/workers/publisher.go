package workers

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/wolfymaster/woofx3/db/database/models"
	"github.com/wolfymaster/woofx3/db/database/repository"
)

type EventPublisher struct {
	repo *repository.DbEventRepository
}

func NewEventPublisher(repo *repository.DbEventRepository) *EventPublisher {
	return &EventPublisher{repo: repo}
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
	payloadBytes, err := json.Marshal(opts.Data)
	if err != nil {
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

	return p.repo.Create(event)
}

func generateUUID() string {
	return fmt.Sprintf("%d", time.Now().UnixNano())
}
