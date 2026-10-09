package services

import (
	"context"
	"errors"
	"fmt"
	"strings"
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
// Outbox publishing is opt-in via `publisher`. When set, every applied
// Create / Update / Delete writes a `db.alert.<op>.system` event in the same
// transaction as the change, so the api gateway can project alerts to Convex
// via the Bearer-auth callback channel, and a change is never committed
// without the event that announces it.
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

	alert, err := s.repo.Create(repo.NewAlert{
		// Generated here rather than by the column default: SQLite has no
		// uuid_generate_v4().
		ID:            uuid.New(),
		Payload:       req.Payload,
		WorkflowID:    workflowID,
		SourceEventID: req.SourceEventId,
		EnvelopeID:    req.EnvelopeId,
	}, s.recordChange("created"))
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to create alert: %w", err))
	}

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
	limit := int(req.Limit)
	offset := int(req.Offset)
	// Sane default for the alert-log page; callers can override.
	if limit <= 0 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}

	alerts, err := s.repo.List(limit, offset)
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to list alerts: %w", err))
	}
	total, err := s.repo.Count()
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
	if req.EnvelopeId == "" {
		return nil, twirp.RequiredArgumentError("envelope_id")
	}
	alert, err := s.repo.GetByEnvelopeID(req.EnvelopeId)
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
	if req.EnvelopeId == "" {
		return nil, twirp.RequiredArgumentError("envelope_id")
	}
	if !repo.IsEnvelopeLifecycleStatus(req.Status) {
		return nil, twirp.InvalidArgumentError("status",
			"must be one of: "+strings.Join(repo.EnvelopeLifecycleStatuses(), ", "))
	}
	alert, applied, err := s.repo.UpdateLifecycle(req.EnvelopeId, req.Status, req.Error, s.recordChange("updated"))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, twirp.NotFoundError("alert not found for envelope")
		}
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to update alert lifecycle: %w", err))
	}
	return s.transitionResponse(alert, applied), nil
}

// UpdateAlertStatus marks a row, by id, `replayed`, through the same
// forward-only transition as UpdateAlertLifecycle; a second replay of one row
// is refused. Replay is its only use: verdicts carry an error and are reported
// against the envelope, through UpdateAlertLifecycle.
func (s *alertService) UpdateAlertStatus(ctx context.Context, req *client.UpdateAlertStatusRequest) (*client.AlertResponse, error) {
	id, err := uuid.Parse(req.Id)
	if err != nil {
		return nil, twirp.InvalidArgumentError("id", "invalid UUID format")
	}
	switch req.Status {
	case repo.AlertStatusReplayed:
		// allowed
	case "":
		return nil, twirp.RequiredArgumentError("status")
	default:
		return nil, twirp.InvalidArgumentError("status", "must be "+repo.AlertStatusReplayed)
	}
	alert, applied, err := s.repo.MarkReplayed(id, s.recordChange("updated"))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, twirp.NotFoundError("alert not found")
		}
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to update alert status: %w", err))
	}
	return s.transitionResponse(alert, applied), nil
}

// transitionResponse answers with the row the transition concerned, as it
// stands: moved when the transition applied, unchanged when it was refused. The
// message says which.
//
// A refused transition is not an error; reporters (several widgets playing
// one alert, a second replay of one row) routinely send transitions the row
// has already passed. It published nothing (see AlertRepository.transition).
func (s *alertService) transitionResponse(alert *models.Alert, applied bool) *client.AlertResponse {
	message := "Alert transition refused; the row is already at or past it"
	if applied {
		message = "Alert updated successfully"
	}
	return &client.AlertResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: message,
		},
		Alert: s.alertToProto(alert),
	}
}

func (s *alertService) DeleteAlert(ctx context.Context, req *client.DeleteAlertRequest) (*client.ResponseStatus, error) {
	id, err := uuid.Parse(req.Id)
	if err != nil {
		return nil, twirp.InvalidArgumentError("id", "invalid UUID format")
	}
	if err := s.repo.Delete(id, s.recordChange("deleted")); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, twirp.NotFoundError("alert not found")
		}
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to delete alert: %w", err))
	}
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
		Payload:       m.Payload,
		WorkflowId:    wf,
		SourceEventId: m.SourceEventID,
		Status:        m.Status,
		EnvelopeId:    m.EnvelopeID,
		Error:         m.Error,
		Version:       m.Version,
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

// recordChange writes the `op` outbox event for a row inside the write's
// transaction (see repo.RecordAlertChange). Without a publisher it records
// nothing.
func (s *alertService) recordChange(op string) repo.RecordAlertChange {
	return func(tx *gorm.DB, alert *models.Alert) error {
		if s.publisher == nil {
			return nil
		}
		return s.publisher.PublishIn(tx, workers.PublishOptions{
			EntityType:      "alert",
			EntityID:        alert.ID.String(),
			Operation:       op,
			Data:            buildAlertChangeData(alert),
			AutoAcknowledge: true,
		})
	}
}

// alertTimestampLayout formats every timestamp in an alert snapshot: RFC
// 3339 in UTC with nine fractional digits. Fixed width and one zone make
// equal values byte-identical, and the full precision the database stores
// survives. Receivers order snapshots by `version`, not by these.
const alertTimestampLayout = "2006-01-02T15:04:05.000000000Z07:00"

func formatAlertTimestamp(t time.Time) string {
	return t.UTC().Format(alertTimestampLayout)
}

func buildAlertChangeData(alert *models.Alert) map[string]interface{} {
	wf := ""
	if alert.WorkflowID != nil {
		wf = alert.WorkflowID.String()
	}
	out := map[string]interface{}{
		"id":              alert.ID.String(),
		"payload":         alert.Payload,
		"workflow_id":     wf,
		"source_event_id": alert.SourceEventID,
		"envelope_id":     alert.EnvelopeID,
		"status":          alert.Status,
		"error":           alert.Error,
		"version":         alert.Version,
		"created_at":      formatAlertTimestamp(alert.CreatedAt),
		"updated_at":      formatAlertTimestamp(alert.UpdatedAt),
	}
	if alert.DispatchedAt != nil {
		out["dispatched_at"] = formatAlertTimestamp(*alert.DispatchedAt)
	}
	if alert.PlayedAt != nil {
		out["played_at"] = formatAlertTimestamp(*alert.PlayedAt)
	}
	if alert.CompletedAt != nil {
		out["completed_at"] = formatAlertTimestamp(*alert.CompletedAt)
	}
	return out
}
