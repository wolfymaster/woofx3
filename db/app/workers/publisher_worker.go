package workers

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	cloudevents "github.com/cloudevents/sdk-go/v2"
	"github.com/nats-io/nats.go"

	"github.com/wolfymaster/woofx3/db/database/models"
	"github.com/wolfymaster/woofx3/db/database/repository"
)

type PublisherWorker struct {
	repo          *repository.DbEventRepository
	natsConn      *nats.Conn
	cache         *EventCache
	logger        *slog.Logger
	pollInterval  time.Duration
	retryInterval time.Duration
	batchSize     int
	defaultTTL    time.Duration
	ctx           context.Context
	cancel        context.CancelFunc
}

func NewPublisherWorker(
	repo *repository.DbEventRepository,
	natsConn *nats.Conn,
	cache *EventCache,
	logger *slog.Logger,
	config Config,
) *PublisherWorker {
	ctx, cancel := context.WithCancel(context.Background())

	return &PublisherWorker{
		repo:          repo,
		natsConn:      natsConn,
		cache:         cache,
		logger:        logger,
		pollInterval:  config.PollInterval,
		retryInterval: config.RetryInterval,
		batchSize:     config.BatchSize,
		defaultTTL:    config.DefaultTTL,
		ctx:           ctx,
		cancel:        cancel,
	}
}

func (w *PublisherWorker) Start() {
	w.logger.Info("publisher worker starting",
		"poll_interval", w.pollInterval,
		"retry_interval", w.retryInterval,
	)

	go w.pollDatabase()
	go w.pollCache()
}

func (w *PublisherWorker) Stop() {
	w.logger.Info("publisher worker stopping")
	w.cancel()
}

func (w *PublisherWorker) pollDatabase() {
	ticker := time.NewTicker(w.pollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-w.ctx.Done():
			w.logger.Info("database poller stopped")
			return

		case <-ticker.C:
			if err := w.processNewEvents(); err != nil {
				w.logger.Error("failed to process new events", "error", err)
			}
		}
	}
}

func (w *PublisherWorker) processNewEvents() error {
	events, err := w.repo.FetchPending(w.ctx, w.batchSize)
	if err != nil {
		return fmt.Errorf("fetch pending events: %w", err)
	}

	if len(events) == 0 {
		return nil
	}

	w.logger.Debug("processing new events", "count", len(events))

	for _, event := range events {
		if err := w.publishEvent(event); err != nil {
			w.logger.Error("failed to publish event",
				"event_id", event.ID,
				"event_type", event.EventType,
				"error", err,
			)
		}
	}

	return nil
}

func (w *PublisherWorker) publishEvent(event *models.WorkerEvent) error {
	ce := cloudevents.NewEvent()
	ce.SetID(event.ID)
	ce.SetSource("db-proxy")
	ce.SetType(event.EventType)
	ce.SetTime(event.CreatedAt)

	ce.SetExtension("application_id", event.ApplicationID)
	ce.SetExtension("entity_type", event.EntityType)
	ce.SetExtension("entity_id", event.EntityID)
	ce.SetExtension("operation", event.Operation)

	if !event.AutoAcknowledge && event.AckSubject != nil {
		ce.SetExtension("ack_subject", *event.AckSubject)
	}

	var payloadData interface{}
	if err := json.Unmarshal(event.Payload, &payloadData); err != nil {
		return fmt.Errorf("unmarshal payload: %w", err)
	}
	ce.SetData(cloudevents.ApplicationJSON, payloadData)

	ceBytes, err := json.Marshal(ce)
	if err != nil {
		return fmt.Errorf("marshal cloudevent: %w", err)
	}

	if err := w.natsConn.Publish(event.NATSSubject, ceBytes); err != nil {
		return fmt.Errorf("nats publish: %w", err)
	}

	if event.AutoAcknowledge {
		if err := w.repo.MarkPublished(event.ID); err != nil {
			w.logger.Error("failed to mark published",
				"event_id", event.ID,
				"error", err,
			)
			return err
		}

		w.logger.Debug("event published (auto-ack)",
			"event_id", event.ID,
			"event_type", event.EventType,
			"subject", event.NATSSubject,
		)
	} else {
		if err := w.repo.MarkPublishing(event.ID); err != nil {
			w.logger.Error("failed to mark publishing",
				"event_id", event.ID,
				"error", err,
			)
			return err
		}

		w.cache.Add(event, w.defaultTTL)

		w.logger.Debug("event published (waiting for ack)",
			"event_id", event.ID,
			"event_type", event.EventType,
			"subject", event.NATSSubject,
			"ack_subject", *event.AckSubject,
			"ttl", w.defaultTTL,
		)
	}

	return nil
}

func (w *PublisherWorker) pollCache() {
	ticker := time.NewTicker(w.retryInterval)
	defer ticker.Stop()

	for {
		select {
		case <-w.ctx.Done():
			w.logger.Info("cache poller stopped")
			return

		case <-ticker.C:
			w.processExpiredEvents()
			w.processMaxRetriesExceeded()
		}
	}
}

func (w *PublisherWorker) processExpiredEvents() {
	expired := w.cache.GetExpired()

	if len(expired) == 0 {
		return
	}

	w.logger.Debug("retrying expired events", "count", len(expired))

	for _, cached := range expired {
		if err := w.retryEvent(cached); err != nil {
			w.logger.Error("failed to retry event",
				"event_id", cached.Event.ID,
				"attempts", cached.Attempts,
				"error", err,
			)
		}
	}
}

func (w *PublisherWorker) processMaxRetriesExceeded() {
	exceeded := w.cache.GetMaxRetriesExceeded()

	for _, cached := range exceeded {
		w.logger.Warn("event exceeded max retries",
			"event_id", cached.Event.ID,
			"attempts", cached.Attempts,
			"max_attempts", cached.Event.MaxAttempts,
		)

		errorMsg := fmt.Sprintf("exceeded max attempts (%d)", cached.Event.MaxAttempts)
		if err := w.repo.MarkFailed(cached.Event.ID, errorMsg); err != nil {
			w.logger.Error("failed to mark event as failed",
				"event_id", cached.Event.ID,
				"error", err,
			)
		}

		w.cache.Remove(cached.Event.ID)
	}
}

func (w *PublisherWorker) retryEvent(cached *CachedEvent) error {
	event := cached.Event

	ce := cloudevents.NewEvent()
	ce.SetID(event.ID)
	ce.SetSource("db-proxy")
	ce.SetType(event.EventType)
	ce.SetTime(event.CreatedAt)

	ce.SetExtension("application_id", event.ApplicationID)
	ce.SetExtension("entity_type", event.EntityType)
	ce.SetExtension("entity_id", event.EntityID)
	ce.SetExtension("operation", event.Operation)

	if event.AckSubject != nil {
		ce.SetExtension("ack_subject", *event.AckSubject)
	}

	var payloadData interface{}
	if err := json.Unmarshal(event.Payload, &payloadData); err != nil {
		return fmt.Errorf("unmarshal payload: %w", err)
	}
	ce.SetData(cloudevents.ApplicationJSON, payloadData)

	ceBytes, err := json.Marshal(ce)
	if err != nil {
		return fmt.Errorf("marshal cloudevent: %w", err)
	}

	if err := w.natsConn.Publish(event.NATSSubject, ceBytes); err != nil {
		return fmt.Errorf("nats publish: %w", err)
	}

	w.cache.UpdateAttempts(event.ID)

	if err := w.repo.IncrementAttempts(event.ID); err != nil {
		w.logger.Error("failed to increment attempts",
			"event_id", event.ID,
			"error", err,
		)
	}

	w.logger.Debug("event retried",
		"event_id", event.ID,
		"event_type", event.EventType,
		"attempts", cached.Attempts+1,
	)

	return nil
}
