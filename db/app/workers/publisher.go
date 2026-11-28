package workers

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/wolfymaster/woofx3/db/database/models"
	"github.com/wolfymaster/woofx3/db/database/repository"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
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

// ContractData is the data of an event with a generated contract: a type
// generated from shared/contracts, which checks itself.
type ContractData interface {
	json.Marshaler
	Validate() error
}

type PublishOptions struct {
	ClientID        string
	EntityType      string
	EntityID        string
	Operation       string
	Data            interface{}
	AutoAcknowledge bool
	MaxAttempts     int
	// Extensions are CloudEvent extensions beyond the outbox's own; see
	// PublishEventIn.
	Extensions map[string]string
	// Context supplies the trace context the event is published under. nil
	// publishes it as the start of a new trace.
	Context context.Context
}

func (p *EventPublisher) Publish(opts PublishOptions) error {
	return p.publishWith(p.repo, opts, outboxSubject(opts), outboxType(opts))
}

// PublishIn writes the event inside the caller's transaction `tx`, so the
// event is published if and only if the change it describes commits: the
// transactional outbox. The worker publishes it once the transaction commits.
func (p *EventPublisher) PublishIn(tx *gorm.DB, opts PublishOptions) error {
	return p.publishWith(p.repo.WithDB(tx), opts, outboxSubject(opts), outboxType(opts))
}

// PublishEventIn writes, inside `tx`, an event whose NATS subject and
// CloudEvent type are both `subject`, for an engine event that workflows
// trigger on: they match on the type, so it cannot carry the `db.` outbox
// subject. The entity type and operation recorded with it are `subject` split
// at its last dot (`viewer.segment` and `entered` for
// `viewer.segment.entered`). It is acknowledged on publish.
//
// data is validated against its generated contract before the row is written,
// so an event that breaks it fails the transaction that produced it instead of
// reaching a consumer.
//
// extensions are CloudEvent extension attributes the event carries besides
// the ones every outbox event does, for what consumers read from the envelope
// rather than the data (the workflow service reads an event's platform only
// from the `platform` extension). Names must be lowercase letters and digits,
// which the CloudEvents SDK otherwise drops on the wire.
func (p *EventPublisher) PublishEventIn(ctx context.Context, tx *gorm.DB, subject, entityID string, extensions map[string]string, data ContractData) error {
	dot := strings.LastIndex(subject, ".")
	if dot <= 0 || dot == len(subject)-1 {
		return fmt.Errorf("publish event: subject %q is not `<entity>.<operation>`", subject)
	}
	if data == nil {
		return fmt.Errorf("publish event %s: no data", subject)
	}
	if err := data.Validate(); err != nil {
		return fmt.Errorf("publish event %s: data breaks its contract: %w", subject, err)
	}
	for name := range extensions {
		if !validExtensionName(name) {
			return fmt.Errorf("publish event %s: extension %q is not lowercase letters and digits", subject, name)
		}
	}
	opts := PublishOptions{
		EntityType:      subject[:dot],
		EntityID:        entityID,
		Operation:       subject[dot+1:],
		Data:            data,
		AutoAcknowledge: true,
		Extensions:      extensions,
		Context:         ctx,
	}
	return p.publishWith(p.repo.WithDB(tx), opts, subject, subject)
}

func validExtensionName(name string) bool {
	if name == "" {
		return false
	}
	for _, r := range name {
		if (r < 'a' || r > 'z') && (r < '0' || r > '9') {
			return false
		}
	}
	return true
}

// outboxSubject is the subject a change to an entity is published on.
// Subscribers match `db.<entity>.<operation>.*`, so the subject carries a
// fixed fourth token.
func outboxSubject(opts PublishOptions) string {
	return fmt.Sprintf("db.%s.%s.%s", opts.EntityType, opts.Operation, subjectScope)
}

func outboxType(opts PublishOptions) string {
	return fmt.Sprintf("%s.%s", opts.EntityType, opts.Operation)
}

func (p *EventPublisher) publishWith(repo *repository.DbEventRepository, opts PublishOptions, subject, eventType string) error {
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

	extensionValues := withTraceContext(opts.Context, opts.Extensions)
	if len(extensionValues) > 0 {
		extensions, err := json.Marshal(extensionValues)
		if err != nil {
			return fmt.Errorf("marshal extensions: %w", err)
		}
		encoded := string(extensions)
		event.Extensions = &encoded
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

// withTraceContext returns extensions plus the traceparent and tracestate of
// ctx's span. They are stored with the event because the worker publishes it
// later, outside the request. An extension the caller set itself wins.
func withTraceContext(ctx context.Context, extensions map[string]string) map[string]string {
	if ctx == nil {
		return extensions
	}
	carrier := propagation.MapCarrier{}
	otel.GetTextMapPropagator().Inject(ctx, carrier)
	if len(carrier) == 0 {
		return extensions
	}
	merged := make(map[string]string, len(extensions)+len(carrier))
	for name, value := range carrier {
		merged[name] = value
	}
	for name, value := range extensions {
		merged[name] = value
	}
	return merged
}

func generateUUID() string {
	return fmt.Sprintf("%d", time.Now().UnixNano())
}
