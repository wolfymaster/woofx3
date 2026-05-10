package services

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/app/workers"
	"github.com/wolfymaster/woofx3/db/database/models"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

// widgetStatusService implements `client.WidgetStatusService`.
//
// Phase 4 of the widget-completion plan: scene-overlay widgets call
// `widgetHost.reportStatus(key, value)`; streamware republishes onto
// NATS `module.widget.status.changed`; the api consumes that subject
// and calls `UpsertWidgetStatus` here. The dashboard sees the change
// via the `WIDGET_STATUS_CHANGED` webhook (driven by the api's
// outbox subscription on `db.widget_status.updated.*`).
type widgetStatusService struct {
	repo      *repo.WidgetStatusRepository
	publisher *workers.EventPublisher
}

func NewWidgetStatusService(
	r *repo.WidgetStatusRepository,
	publisher *workers.EventPublisher,
) client.WidgetStatusService {
	return &widgetStatusService{
		repo:      r,
		publisher: publisher,
	}
}

func (s *widgetStatusService) UpsertWidgetStatus(ctx context.Context, req *client.UpsertWidgetStatusRequest) (*client.WidgetStatusResponse, error) {
	appIDStr, err := resolveApplicationID(ctx, s.repo.DB(), req.ApplicationId)
	if err != nil {
		return nil, err
	}
	applicationID, err := uuid.Parse(appIDStr)
	if err != nil {
		return nil, twirp.InvalidArgumentError("application_id", "invalid UUID format")
	}
	if req.InstanceId == "" {
		return nil, twirp.RequiredArgumentError("instance_id")
	}
	if req.Key == "" {
		return nil, twirp.RequiredArgumentError("key")
	}
	if req.Value == "" {
		return nil, twirp.RequiredArgumentError("value")
	}

	occurredAt := time.Now().UTC()
	if req.OccurredAt != "" {
		parsed, parseErr := time.Parse(time.RFC3339Nano, req.OccurredAt)
		if parseErr != nil {
			return nil, twirp.InvalidArgumentError("occurred_at", "must be RFC3339")
		}
		occurredAt = parsed.UTC()
	}

	row := &models.WidgetStatus{
		ApplicationID:     applicationID,
		ModuleID:          req.ModuleId,
		InstanceID:        req.InstanceId,
		WidgetCanonicalID: req.WidgetCanonicalId,
		Key:               req.Key,
		Value:             req.Value,
		OccurredAt:        occurredAt,
	}
	saved, err := s.repo.Upsert(row)
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to upsert widget status: %w", err))
	}
	s.publishChange(applicationID.String(), saved, "updated")
	return &client.WidgetStatusResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Widget status upserted",
		},
		WidgetStatus: s.toProto(saved),
	}, nil
}

func (s *widgetStatusService) GetWidgetStatus(ctx context.Context, req *client.GetWidgetStatusRequest) (*client.WidgetStatusResponse, error) {
	appIDStr, err := resolveApplicationID(ctx, s.repo.DB(), req.ApplicationId)
	if err != nil {
		return nil, err
	}
	applicationID, err := uuid.Parse(appIDStr)
	if err != nil {
		return nil, twirp.InvalidArgumentError("application_id", "invalid UUID format")
	}
	if req.InstanceId == "" {
		return nil, twirp.RequiredArgumentError("instance_id")
	}
	if req.Key == "" {
		return nil, twirp.RequiredArgumentError("key")
	}
	row, err := s.repo.Get(applicationID, req.InstanceId, req.Key)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, twirp.NotFoundError("widget status not found")
		}
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to load widget status: %w", err))
	}
	return &client.WidgetStatusResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Widget status retrieved",
		},
		WidgetStatus: s.toProto(row),
	}, nil
}

func (s *widgetStatusService) ListWidgetStatus(ctx context.Context, req *client.ListWidgetStatusRequest) (*client.ListWidgetStatusResponse, error) {
	appIDStr, err := resolveApplicationID(ctx, s.repo.DB(), req.ApplicationId)
	if err != nil {
		return nil, err
	}
	applicationID, err := uuid.Parse(appIDStr)
	if err != nil {
		return nil, twirp.InvalidArgumentError("application_id", "invalid UUID format")
	}
	limit := int(req.Limit)
	offset := int(req.Offset)
	if limit <= 0 {
		limit = 200
	}
	if offset < 0 {
		offset = 0
	}
	rows, err := s.repo.ListByApplicationID(applicationID, req.ModuleId, req.InstanceId, limit, offset)
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to list widget status: %w", err))
	}
	total, err := s.repo.CountByApplicationID(applicationID, req.ModuleId, req.InstanceId)
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to count widget status: %w", err))
	}
	out := make([]*client.WidgetStatus, len(rows))
	for i, r := range rows {
		out[i] = s.toProto(r)
	}
	return &client.ListWidgetStatusResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Widget status retrieved",
		},
		Rows:       out,
		TotalCount: total,
		Limit:      int32(limit),
		Offset:     int32(offset),
	}, nil
}

func (s *widgetStatusService) DeleteWidgetStatus(ctx context.Context, req *client.DeleteWidgetStatusRequest) (*client.ResponseStatus, error) {
	appIDStr, err := resolveApplicationID(ctx, s.repo.DB(), req.ApplicationId)
	if err != nil {
		return nil, err
	}
	applicationID, err := uuid.Parse(appIDStr)
	if err != nil {
		return nil, twirp.InvalidArgumentError("application_id", "invalid UUID format")
	}
	if req.InstanceId == "" {
		return nil, twirp.RequiredArgumentError("instance_id")
	}
	if err := s.repo.Delete(applicationID, req.InstanceId, req.Key); err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to delete widget status: %w", err))
	}
	return &client.ResponseStatus{
		Code:    client.ResponseStatus_OK,
		Message: "Widget status deleted",
	}, nil
}

func (s *widgetStatusService) toProto(m *models.WidgetStatus) *client.WidgetStatus {
	return &client.WidgetStatus{
		Id:                m.ID.String(),
		ApplicationId:     m.ApplicationID.String(),
		ModuleId:          m.ModuleID,
		InstanceId:        m.InstanceID,
		WidgetCanonicalId: m.WidgetCanonicalID,
		Key:               m.Key,
		Value:             m.Value,
		OccurredAt:        timestamppb.New(m.OccurredAt),
		CreatedAt:         timestamppb.New(m.CreatedAt),
		UpdatedAt:         timestamppb.New(m.UpdatedAt),
	}
}

func (s *widgetStatusService) publishChange(applicationID string, row *models.WidgetStatus, op string) {
	if s.publisher == nil {
		return
	}
	s.publisher.Publish(workers.PublishOptions{
		ApplicationID: applicationID,
		EntityType:    "widget_status",
		EntityID:      row.ID.String(),
		Operation:     op,
		Data: map[string]interface{}{
			"id":                  row.ID.String(),
			"application_id":      row.ApplicationID.String(),
			"module_id":           row.ModuleID,
			"instance_id":         row.InstanceID,
			"widget_canonical_id": row.WidgetCanonicalID,
			"key":                 row.Key,
			"value":               row.Value,
			"occurred_at":         row.OccurredAt.Format(time.RFC3339Nano),
			"created_at":          row.CreatedAt.Format(time.RFC3339Nano),
			"updated_at":          row.UpdatedAt.Format(time.RFC3339Nano),
		},
		AutoAcknowledge: true,
	})
}
