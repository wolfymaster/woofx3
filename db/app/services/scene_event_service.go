package services

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/database/models"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

// sceneEventService implements `client.SceneEventService` — the
// durable, at-least-once scene event delivery pipeline sceneManager
// uses (see `scene_event.proto`). Symmetric with `widgetStatusService`.
type sceneEventService struct {
	repo *repo.SceneEventRepository
}

func NewSceneEventService(r *repo.SceneEventRepository) client.SceneEventService {
	return &sceneEventService{repo: r}
}

func (s *sceneEventService) RecordSceneEvent(ctx context.Context, req *client.RecordSceneEventRequest) (*client.SceneEventResponse, error) {
	sceneID, err := uuid.Parse(req.SceneId)
	if err != nil {
		return nil, twirp.InvalidArgumentError("scene_id", "invalid UUID format")
	}
	appIDStr, err := resolveApplicationID(ctx, s.repo.DB(), req.ApplicationId)
	if err != nil {
		return nil, err
	}
	applicationID, err := uuid.Parse(appIDStr)
	if err != nil {
		return nil, twirp.InvalidArgumentError("application_id", "invalid UUID format")
	}
	if req.Type == "" {
		return nil, twirp.RequiredArgumentError("type")
	}
	if req.Key == "" {
		return nil, twirp.RequiredArgumentError("key")
	}
	if len(req.TargetInstanceIds) == 0 {
		return nil, twirp.RequiredArgumentError("target_instance_ids")
	}

	occurredAt := time.Now().UTC()
	if req.OccurredAt != "" {
		parsed, parseErr := time.Parse(time.RFC3339Nano, req.OccurredAt)
		if parseErr != nil {
			return nil, twirp.InvalidArgumentError("occurred_at", "must be RFC3339")
		}
		occurredAt = parsed.UTC()
	}

	value := req.Value
	if value == "" {
		value = "{}"
	}

	row := &models.SceneEvent{
		ID:            uuid.New(),
		SceneID:       sceneID,
		ApplicationID: applicationID,
		Type:          req.Type,
		Key:           req.Key,
		Value:         value,
		OccurredAt:    occurredAt,
	}
	saved, err := s.repo.RecordSceneEvent(row, req.TargetInstanceIds)
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to record scene event: %w", err))
	}
	return &client.SceneEventResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Scene event recorded",
		},
		SceneEvent: s.toProto(saved),
	}, nil
}

func (s *sceneEventService) RecordDelivery(ctx context.Context, req *client.RecordDeliveryRequest) (*client.ResponseStatus, error) {
	sceneEventID, err := uuid.Parse(req.SceneEventId)
	if err != nil {
		return nil, twirp.InvalidArgumentError("scene_event_id", "invalid UUID format")
	}
	if req.InstanceId == "" {
		return nil, twirp.RequiredArgumentError("instance_id")
	}
	if err := s.repo.RecordDelivery(sceneEventID, req.InstanceId); err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to record delivery: %w", err))
	}
	return &client.ResponseStatus{Code: client.ResponseStatus_OK, Message: "Delivery recorded"}, nil
}

func (s *sceneEventService) RecordCompletion(ctx context.Context, req *client.RecordCompletionRequest) (*client.ResponseStatus, error) {
	sceneEventID, err := uuid.Parse(req.SceneEventId)
	if err != nil {
		return nil, twirp.InvalidArgumentError("scene_event_id", "invalid UUID format")
	}
	if req.InstanceId == "" {
		return nil, twirp.RequiredArgumentError("instance_id")
	}
	if err := s.repo.RecordCompletion(sceneEventID, req.InstanceId); err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to record completion: %w", err))
	}
	return &client.ResponseStatus{Code: client.ResponseStatus_OK, Message: "Completion recorded"}, nil
}

func (s *sceneEventService) ListOpenSceneEventDeliveries(ctx context.Context, req *client.ListOpenSceneEventDeliveriesRequest) (*client.ListOpenSceneEventDeliveriesResponse, error) {
	var sceneID *uuid.UUID
	if req.SceneId != "" {
		parsed, err := uuid.Parse(req.SceneId)
		if err != nil {
			return nil, twirp.InvalidArgumentError("scene_id", "invalid UUID format")
		}
		sceneID = &parsed
	}
	rows, err := s.repo.ListOpenDeliveries(sceneID)
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to list open scene event deliveries: %w", err))
	}
	out := make([]*client.SceneEventDelivery, len(rows))
	for i, r := range rows {
		out[i] = s.deliveryToProto(r)
	}
	return &client.ListOpenSceneEventDeliveriesResponse{
		Status:     &client.ResponseStatus{Code: client.ResponseStatus_OK, Message: "Open deliveries retrieved"},
		Deliveries: out,
	}, nil
}

func (s *sceneEventService) GetSceneEvent(ctx context.Context, req *client.GetSceneEventRequest) (*client.SceneEventResponse, error) {
	id, err := uuid.Parse(req.Id)
	if err != nil {
		return nil, twirp.InvalidArgumentError("id", "invalid UUID format")
	}
	row, err := s.repo.GetSceneEvent(id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, twirp.NotFoundError("scene event not found")
		}
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to load scene event: %w", err))
	}
	return &client.SceneEventResponse{
		Status:     &client.ResponseStatus{Code: client.ResponseStatus_OK, Message: "Scene event retrieved"},
		SceneEvent: s.toProto(row),
	}, nil
}

func (s *sceneEventService) ListSceneEventLog(ctx context.Context, req *client.ListSceneEventLogRequest) (*client.ListSceneEventLogResponse, error) {
	var sceneEventID, sceneID *uuid.UUID
	if req.SceneEventId != "" {
		parsed, err := uuid.Parse(req.SceneEventId)
		if err != nil {
			return nil, twirp.InvalidArgumentError("scene_event_id", "invalid UUID format")
		}
		sceneEventID = &parsed
	}
	if req.SceneId != "" {
		parsed, err := uuid.Parse(req.SceneId)
		if err != nil {
			return nil, twirp.InvalidArgumentError("scene_id", "invalid UUID format")
		}
		sceneID = &parsed
	}
	if sceneEventID == nil && sceneID == nil {
		return nil, twirp.InvalidArgumentError("scene_event_id", "at least one of scene_event_id or scene_id is required")
	}
	limit := int(req.Limit)
	offset := int(req.Offset)
	if limit <= 0 {
		limit = 200
	}
	if offset < 0 {
		offset = 0
	}
	rows, total, err := s.repo.ListSceneEventLog(sceneEventID, sceneID, limit, offset)
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to list scene event log: %w", err))
	}
	out := make([]*client.SceneEventLogEntry, len(rows))
	for i, r := range rows {
		out[i] = s.logEntryToProto(r)
	}
	return &client.ListSceneEventLogResponse{
		Status:     &client.ResponseStatus{Code: client.ResponseStatus_OK, Message: "Scene event log retrieved"},
		Entries:    out,
		TotalCount: total,
	}, nil
}

func (s *sceneEventService) toProto(m *models.SceneEvent) *client.SceneEvent {
	return &client.SceneEvent{
		Id:            m.ID.String(),
		SceneId:       m.SceneID.String(),
		ApplicationId: m.ApplicationID.String(),
		Type:          m.Type,
		Key:           m.Key,
		Value:         m.Value,
		OccurredAt:    timestamppb.New(m.OccurredAt),
		CreatedAt:     timestamppb.New(m.CreatedAt),
	}
}

func (s *sceneEventService) deliveryToProto(m *models.SceneEventDelivery) *client.SceneEventDelivery {
	out := &client.SceneEventDelivery{
		SceneEventId:  m.SceneEventID.String(),
		SceneId:       m.SceneID.String(),
		InstanceId:    m.InstanceID,
		LastAttemptAt: timestamppb.New(m.LastAttemptAt),
		CreatedAt:     timestamppb.New(m.CreatedAt),
	}
	if m.DeliveredAt != nil {
		out.DeliveredAt = timestamppb.New(*m.DeliveredAt)
	}
	if m.CompletedAt != nil {
		out.CompletedAt = timestamppb.New(*m.CompletedAt)
	}
	return out
}

func (s *sceneEventService) logEntryToProto(m *models.SceneEventLogEntry) *client.SceneEventLogEntry {
	return &client.SceneEventLogEntry{
		Id:           m.ID.String(),
		SceneEventId: m.SceneEventID.String(),
		SceneId:      m.SceneID.String(),
		InstanceId:   m.InstanceID,
		Kind:         m.Kind,
		OccurredAt:   timestamppb.New(m.OccurredAt),
		CreatedAt:    timestamppb.New(m.CreatedAt),
	}
}
