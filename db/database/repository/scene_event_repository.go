package repository

import (
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
)

// SceneEventRepository backs the durable, at-least-once scene event
// delivery pipeline (see `scene_event.proto`). Same pattern as
// `WidgetStatusRepository` / `AlertRepository`.
//
// It stamps acks from `now` rather than a SQL time function, for the reason
// ModuleRepository gives.
type SceneEventRepository struct {
	db  *gorm.DB
	now func() time.Time
}

func NewSceneEventRepository(db *gorm.DB, now func() time.Time) *SceneEventRepository {
	return &SceneEventRepository{db: db, now: now}
}

// RecordSceneEvent persists the parent row plus one open delivery row
// per fan-out target, in a single transaction — the row set must exist
// before the caller pushes the event down the SSE stream, so a crash
// between persistence and delivery is still recoverable on restart.
func (r *SceneEventRepository) RecordSceneEvent(event *models.SceneEvent, targetInstanceIDs []string) (*models.SceneEvent, error) {
	if event.SceneID == uuid.Nil {
		return nil, fmt.Errorf("scene_id is required")
	}
	if len(targetInstanceIDs) == 0 {
		return nil, fmt.Errorf("at least one target_instance_id is required")
	}

	err := r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(event).Error; err != nil {
			return err
		}
		deliveries := make([]*models.SceneEventDelivery, len(targetInstanceIDs))
		for i, instanceID := range targetInstanceIDs {
			deliveries[i] = &models.SceneEventDelivery{
				SceneEventID:  event.ID,
				SceneID:       event.SceneID,
				InstanceID:    instanceID,
				LastAttemptAt: event.OccurredAt,
			}
		}
		return tx.Create(&deliveries).Error
	})
	if err != nil {
		return nil, err
	}
	return event, nil
}

// RecordDelivery appends a "delivered" log row and updates the
// matching delivery row's `delivered_at`/`last_attempt_at`. A delivery
// row that no longer exists (already completed, or never existed) is
// treated as a no-op — the caller's ack arrived late or twice, not an
// error.
func (r *SceneEventRepository) RecordDelivery(sceneEventID uuid.UUID, instanceID string) error {
	return r.appendLog(sceneEventID, instanceID, "delivered", func(tx *gorm.DB, delivery *models.SceneEventDelivery, at time.Time) error {
		return tx.Model(&models.SceneEventDelivery{}).
			Where("scene_event_id = ? AND instance_id = ?", sceneEventID, instanceID).
			Updates(map[string]interface{}{
				"delivered_at":    at,
				"last_attempt_at": at,
			}).Error
	})
}

// RecordCompletion appends a "completed" log row and removes the
// matching delivery row — its job as a working-set entry is done; the
// log row is the permanent record. Idempotent: completing an
// already-completed (deleted) delivery is a no-op, not an error.
func (r *SceneEventRepository) RecordCompletion(sceneEventID uuid.UUID, instanceID string) error {
	return r.appendLog(sceneEventID, instanceID, "completed", func(tx *gorm.DB, delivery *models.SceneEventDelivery, _ time.Time) error {
		return tx.Where("scene_event_id = ? AND instance_id = ?", sceneEventID, instanceID).
			Delete(&models.SceneEventDelivery{}).Error
	})
}

// appendLog is the shared transaction shape for RecordDelivery /
// RecordCompletion: look up the delivery row (for its scene_id, and to
// no-op when it's already gone), append the log row, then run the
// caller's mutation against the delivery row.
func (r *SceneEventRepository) appendLog(
	sceneEventID uuid.UUID,
	instanceID string,
	kind string,
	mutate func(tx *gorm.DB, delivery *models.SceneEventDelivery, at time.Time) error,
) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var delivery models.SceneEventDelivery
		err := tx.Where("scene_event_id = ? AND instance_id = ?", sceneEventID, instanceID).First(&delivery).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		// The id is a time-ordered UUIDv7, so two entries stamped with the
		// same time still list in the order they were written (see
		// ListSceneEventLog).
		id, err := uuid.NewV7()
		if err != nil {
			return fmt.Errorf("scene event log id: %w", err)
		}
		at := r.now().UTC()
		entry := &models.SceneEventLogEntry{
			ID:           id,
			SceneEventID: sceneEventID,
			SceneID:      delivery.SceneID,
			InstanceID:   instanceID,
			Kind:         kind,
			OccurredAt:   at,
		}
		if err := tx.Create(entry).Error; err != nil {
			return err
		}
		return mutate(tx, &delivery, at)
	})
}

// ListOpenDeliveries is the startup hydration / redelivery sweep
// source: every currently-open delivery, optionally narrowed to one
// scene. Because `scene_event_deliveries` only ever holds open rows,
// this is a cheap, bounded scan.
func (r *SceneEventRepository) ListOpenDeliveries(sceneID *uuid.UUID) ([]*models.SceneEventDelivery, error) {
	q := r.db.Model(&models.SceneEventDelivery{})
	if sceneID != nil {
		q = q.Where("scene_id = ?", *sceneID)
	}
	var rows []*models.SceneEventDelivery
	err := q.Order("created_at ASC").Find(&rows).Error
	return rows, err
}

func (r *SceneEventRepository) GetSceneEvent(id uuid.UUID) (*models.SceneEvent, error) {
	var row models.SceneEvent
	err := r.db.Where("id = ?", id).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, gorm.ErrRecordNotFound
	}
	return &row, err
}

// ListSceneEventLog is the timeline / replay query. At least one of
// `sceneEventID` / `sceneID` should be set by the caller; both narrow
// further when both are provided.
func (r *SceneEventRepository) ListSceneEventLog(sceneEventID, sceneID *uuid.UUID, limit, offset int) ([]*models.SceneEventLogEntry, int64, error) {
	q := r.db.Model(&models.SceneEventLogEntry{})
	if sceneEventID != nil {
		q = q.Where("scene_event_id = ?", *sceneEventID)
	}
	if sceneID != nil {
		q = q.Where("scene_id = ?", *sceneID)
	}
	var total int64
	if err := q.Session(&gorm.Session{}).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	// The id breaks ties between entries stamped with the same time; it is
	// time-ordered, so they keep the order they were written in.
	q = q.Order("occurred_at ASC").Order("id ASC")
	if limit > 0 {
		q = q.Limit(limit).Offset(offset)
	}
	var rows []*models.SceneEventLogEntry
	err := q.Find(&rows).Error
	return rows, total, err
}
