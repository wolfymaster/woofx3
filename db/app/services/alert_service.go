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

// alertService implements `client.AlertService` (Twirp-generated).
//
// Mirrors `sceneService` in shape: typed audit fields go through
// columns, the heavy `payload` blob passes through as an opaque
// string the engine never inspects.
//
// Outbox publishing is opt-in via `publisher`. When set, every
// successful Create / Update / Delete emits a
// `db.alert.<op>.<applicationId>` event so the api gateway can
// project new alerts to Convex via the Bearer-auth callback channel.
type alertService struct {
	repo      *repo.AlertRepository
	publisher *workers.EventPublisher
}

func NewAlertService(
	alertRepo *repo.AlertRepository,
	publisher *workers.EventPublisher,
) client.AlertService {
	return &alertService{
		repo:      alertRepo,
		publisher: publisher,
	}
}

func (s *alertService) CreateAlert(ctx context.Context, req *client.CreateAlertRequest) (*client.AlertResponse, error) {
	appIDStr, err := resolveApplicationID(ctx, s.repo.DB(), req.ApplicationId)
	if err != nil {
		return nil, err
	}
	applicationID, err := uuid.Parse(appIDStr)
	if err != nil {
		return nil, twirp.InvalidArgumentError("application_id", "invalid UUID format")
	}
	if req.Payload == "" {
		return nil, twirp.RequiredArgumentError("payload")
	}

	var workflowID *uuid.UUID
	if req.WorkflowId != "" {
		parsed, parseErr := uuid.Parse(req.WorkflowId)
		if parseErr != nil {
			return nil, twirp.InvalidArgumentError("workflow_id", "invalid UUID format")
		}
		workflowID = &parsed
	}

	now := time.Now().UTC()
	alert := &models.Alert{
		ApplicationID: applicationID,
		Payload:       req.Payload,
		WorkflowID:    workflowID,
		SourceEventID: req.SourceEventId,
		EnvelopeID:    req.EnvelopeId,
		Status:        "sent",
		DispatchedAt:  &now,
	}
	if err := s.repo.Create(alert); err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to create alert: %w", err))
	}

	s.publishChange(appIDStr, alert, "created")

	return &client.AlertResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Alert recorded successfully",
		},
		Alert: s.alertToProto(alert),
	}, nil
}

func (s *alertService) GetAlert(ctx context.Context, req *client.GetAlertRequest) (*client.AlertResponse, error) {
	id, err := uuid.Parse(req.Id)
	if err != nil {
		return nil, twirp.InvalidArgumentError("id", "invalid UUID format")
	}
	alert, err := s.repo.GetByID(id)
	if err != nil {
		return nil, twirp.NotFoundError("alert not found")
	}
	return &client.AlertResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Alert retrieved successfully",
		},
		Alert: s.alertToProto(alert),
	}, nil
}

func (s *alertService) ListAlerts(ctx context.Context, req *client.ListAlertsRequest) (*client.ListAlertsResponse, error) {
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
	// Sane default for the alert-log page; callers can override.
	if limit <= 0 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}

	alerts, err := s.repo.GetByApplicationID(applicationID, limit, offset)
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to list alerts: %w", err))
	}
	total, err := s.repo.CountByApplicationID(applicationID)
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to count alerts: %w", err))
	}

	out := make([]*client.Alert, len(alerts))
	for i, a := range alerts {
		out[i] = s.alertToProto(a)
	}

	return &client.ListAlertsResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Alerts retrieved successfully",
		},
		Alerts:     out,
		TotalCount: total,
		Limit:      int32(limit),
		Offset:     int32(offset),
	}, nil
}

func (s *alertService) GetAlertByEnvelopeId(ctx context.Context, req *client.GetAlertByEnvelopeIdRequest) (*client.AlertResponse, error) {
	appIDStr, err := resolveApplicationID(ctx, s.repo.DB(), req.ApplicationId)
	if err != nil {
		return nil, err
	}
	applicationID, err := uuid.Parse(appIDStr)
	if err != nil {
		return nil, twirp.InvalidArgumentError("application_id", "invalid UUID format")
	}
	if req.EnvelopeId == "" {
		return nil, twirp.RequiredArgumentError("envelope_id")
	}
	alert, err := s.repo.GetByEnvelopeID(applicationID, req.EnvelopeId)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, twirp.NotFoundError("alert not found for envelope")
		}
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to load alert: %w", err))
	}
	return &client.AlertResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Alert retrieved successfully",
		},
		Alert: s.alertToProto(alert),
	}, nil
}

func (s *alertService) UpdateAlertLifecycle(ctx context.Context, req *client.UpdateAlertLifecycleRequest) (*client.AlertResponse, error) {
	appIDStr, err := resolveApplicationID(ctx, s.repo.DB(), req.ApplicationId)
	if err != nil {
		return nil, err
	}
	applicationID, err := uuid.Parse(appIDStr)
	if err != nil {
		return nil, twirp.InvalidArgumentError("application_id", "invalid UUID format")
	}
	if req.EnvelopeId == "" {
		return nil, twirp.RequiredArgumentError("envelope_id")
	}
	switch req.Status {
	case "dispatched", "playing", "completed", "failed", "timed_out", "skipped":
		// allowed
	default:
		return nil, twirp.InvalidArgumentError("status",
			"must be one of: dispatched, playing, completed, failed, timed_out, skipped")
	}
	alert, err := s.repo.UpdateLifecycle(applicationID, req.EnvelopeId, req.Status, req.Error)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, twirp.NotFoundError("alert not found for envelope")
		}
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to update alert lifecycle: %w", err))
	}
	s.publishChange(alert.ApplicationID.String(), alert, "updated")
	return &client.AlertResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Alert lifecycle updated successfully",
		},
		Alert: s.alertToProto(alert),
	}, nil
}

func (s *alertService) UpdateAlertStatus(ctx context.Context, req *client.UpdateAlertStatusRequest) (*client.AlertResponse, error) {
	id, err := uuid.Parse(req.Id)
	if err != nil {
		return nil, twirp.InvalidArgumentError("id", "invalid UUID format")
	}
	if req.Status == "" {
		return nil, twirp.RequiredArgumentError("status")
	}
	if err := s.repo.UpdateStatus(id, req.Status); err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to update alert status: %w", err))
	}
	alert, err := s.repo.GetByID(id)
	if err != nil {
		return nil, twirp.NotFoundError("alert not found")
	}
	s.publishChange(alert.ApplicationID.String(), alert, "updated")
	return &client.AlertResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Alert status updated successfully",
		},
		Alert: s.alertToProto(alert),
	}, nil
}

func (s *alertService) DeleteAlert(ctx context.Context, req *client.DeleteAlertRequest) (*client.ResponseStatus, error) {
	id, err := uuid.Parse(req.Id)
	if err != nil {
		return nil, twirp.InvalidArgumentError("id", "invalid UUID format")
	}
	alert, err := s.repo.GetByID(id)
	if err != nil {
		return nil, twirp.NotFoundError("alert not found")
	}
	if err := s.repo.Delete(id); err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to delete alert: %w", err))
	}
	s.publishChange(alert.ApplicationID.String(), alert, "deleted")
	return &client.ResponseStatus{
		Code:    client.ResponseStatus_OK,
		Message: "Alert deleted successfully",
	}, nil
}

func (s *alertService) alertToProto(m *models.Alert) *client.Alert {
	wf := ""
	if m.WorkflowID != nil {
		wf = m.WorkflowID.String()
	}
	out := &client.Alert{
		Id:            m.ID.String(),
		ApplicationId: m.ApplicationID.String(),
		Payload:       m.Payload,
		WorkflowId:    wf,
		SourceEventId: m.SourceEventID,
		Status:        m.Status,
		EnvelopeId:    m.EnvelopeID,
		Error:         m.Error,
		CreatedAt:     timestamppb.New(m.CreatedAt),
		UpdatedAt:     timestamppb.New(m.UpdatedAt),
	}
	if m.DispatchedAt != nil {
		out.DispatchedAt = timestamppb.New(*m.DispatchedAt)
	}
	if m.PlayedAt != nil {
		out.PlayedAt = timestamppb.New(*m.PlayedAt)
	}
	if m.CompletedAt != nil {
		out.CompletedAt = timestamppb.New(*m.CompletedAt)
	}
	return out
}

func (s *alertService) publishChange(applicationID string, alert *models.Alert, op string) {
	if s.publisher == nil {
		return
	}
	s.publisher.Publish(workers.PublishOptions{
		ApplicationID:   applicationID,
		EntityType:      "alert",
		EntityID:        alert.ID.String(),
		Operation:       op,
		Data:            buildAlertChangeData(alert),
		AutoAcknowledge: true,
	})
}

func buildAlertChangeData(alert *models.Alert) map[string]interface{} {
	wf := ""
	if alert.WorkflowID != nil {
		wf = alert.WorkflowID.String()
	}
	out := map[string]interface{}{
		"id":              alert.ID.String(),
		"application_id":  alert.ApplicationID.String(),
		"payload":         alert.Payload,
		"workflow_id":     wf,
		"source_event_id": alert.SourceEventID,
		"envelope_id":     alert.EnvelopeID,
		"status":          alert.Status,
		"error":           alert.Error,
		"created_at":      alert.CreatedAt.Format("2006-01-02T15:04:05.000Z07:00"),
		"updated_at":      alert.UpdatedAt.Format("2006-01-02T15:04:05.000Z07:00"),
	}
	if alert.DispatchedAt != nil {
		out["dispatched_at"] = alert.DispatchedAt.Format("2006-01-02T15:04:05.000Z07:00")
	}
	if alert.PlayedAt != nil {
		out["played_at"] = alert.PlayedAt.Format("2006-01-02T15:04:05.000Z07:00")
	}
	if alert.CompletedAt != nil {
		out["completed_at"] = alert.CompletedAt.Format("2006-01-02T15:04:05.000Z07:00")
	}
	return out
}
