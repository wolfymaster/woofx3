package workers

import (
	"encoding/json"
	"log/slog"

	"github.com/nats-io/nats.go"

	"github.com/wolfymaster/woofx3/db/database/repository"
)

type AckMessage struct {
	EventID string  `json:"event_id"`
	Status  string  `json:"status"`
	Error   *string `json:"error,omitempty"`
}

type AckWorker struct {
	repo     *repository.DbEventRepository
	natsConn *nats.Conn
	cache    *EventCache
	logger   *slog.Logger
	sub      *nats.Subscription
}

func NewAckWorker(
	repo *repository.DbEventRepository,
	natsConn *nats.Conn,
	cache *EventCache,
	logger *slog.Logger,
) *AckWorker {
	return &AckWorker{
		repo:     repo,
		natsConn: natsConn,
		cache:    cache,
		logger:   logger,
	}
}

func (w *AckWorker) Start() error {
	var err error

	w.sub, err = w.natsConn.Subscribe("db.ack.>", w.handleAck)
	if err != nil {
		return err
	}

	w.logger.Info("ack worker started", "subject", "db.ack.>")
	return nil
}

func (w *AckWorker) Stop() {
	if w.sub != nil {
		w.sub.Unsubscribe()
		w.logger.Info("ack worker stopped")
	}
}

func (w *AckWorker) handleAck(msg *nats.Msg) {
	var ack AckMessage
	if err := json.Unmarshal(msg.Data, &ack); err != nil {
		w.logger.Error("failed to unmarshal ack", "error", err)
		return
	}

	cached, exists := w.cache.Get(ack.EventID)
	if !exists {
		w.logger.Warn("received ack for unknown event",
			"event_id", ack.EventID,
		)
		return
	}

	w.logger.Debug("received acknowledgment",
		"event_id", ack.EventID,
		"status", ack.Status,
		"attempts", cached.Attempts,
	)

	switch ack.Status {
	case "success":
		if err := w.repo.MarkAcknowledged(ack.EventID); err != nil {
			w.logger.Error("failed to mark acknowledged",
				"event_id", ack.EventID,
				"error", err,
			)
			return
		}

		w.cache.Remove(ack.EventID)

		w.logger.Info("event acknowledged",
			"event_id", ack.EventID,
			"event_type", cached.Event.EventType,
			"attempts", cached.Attempts,
		)

	case "failure":
		errorMsg := "subscriber reported failure"
		if ack.Error != nil {
			errorMsg = *ack.Error
		}

		w.logger.Warn("event processing failed",
			"event_id", ack.EventID,
			"error", errorMsg,
			"attempts", cached.Attempts,
			"max_attempts", cached.Event.MaxAttempts,
		)

		if !cached.CanRetry() {
			if err := w.repo.MarkFailed(ack.EventID, errorMsg); err != nil {
				w.logger.Error("failed to mark failed",
					"event_id", ack.EventID,
					"error", err,
				)
			}

			w.cache.Remove(ack.EventID)

			w.logger.Error("event failed after max retries",
				"event_id", ack.EventID,
				"attempts", cached.Attempts,
			)
		} else {
			w.logger.Info("event will be retried",
				"event_id", ack.EventID,
				"attempts", cached.Attempts,
				"max_attempts", cached.Event.MaxAttempts,
			)
		}

	default:
		w.logger.Warn("unknown ack status",
			"event_id", ack.EventID,
			"status", ack.Status,
		)
	}
}
