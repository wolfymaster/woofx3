package services

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/database/models"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Column widths of user_events. Checked here rather than left to the
// database, because Postgres rejects an over-long value and SQLite stores it,
// and the two dialects must accept the same events.
const (
	userEventIDMaxLen        = 255
	userEventSourceMaxLen    = 255
	userEventTypeMaxLen      = 100
	userEventPlatformMaxLen  = 50
	userEventUserIDMaxLen    = 100
	userEventUserNameMaxLen  = 100
	userEventSessionIDMaxLen = 100
)

// userEventService implements `client.UserEventService`: the append-only log
// of platform events that Analytics aggregates.
//
// Recording publishes nothing to the outbox. The event being recorded is
// already on the bus, and the log is written at event rate, so echoing each
// row would double the traffic for no new information.
type userEventService struct {
	repo *repo.UserEventRepository
}

func NewUserEventService(userEventRepo *repo.UserEventRepository) client.UserEventService {
	return &userEventService{repo: userEventRepo}
}

func (s *userEventService) RecordUserEvent(ctx context.Context, req *client.RecordUserEventRequest) (*client.RecordUserEventResponse, error) {
	if err := validateRecordUserEvent(req); err != nil {
		return nil, err
	}

	eventValue := req.EventValue
	if eventValue == "" {
		eventValue = "{}"
	}
	occurredAt := time.Now().UTC()
	if req.OccurredAt != nil {
		occurredAt = req.OccurredAt.AsTime().UTC()
	}

	event := &models.UserEvent{
		ID:             uuid.New(),
		EventID:        req.EventId,
		Source:         req.Source,
		EventType:      req.EventType,
		Platform:       req.Platform,
		PlatformUserID: req.PlatformUserId,
		UserName:       req.UserName,
		SessionID:      req.SessionId,
		Amount:         req.Amount,
		EventValue:     eventValue,
		OccurredAt:     occurredAt,
		CreatedAt:      time.Now().UTC(),
	}
	stored, created, err := s.repo.Record(event)
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to record user event: %w", err))
	}

	message := "User event recorded"
	if !created {
		message = "User event already recorded"
	}
	return &client.RecordUserEventResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: message,
		},
		Event:   userEventToProto(stored),
		Created: created,
	}, nil
}

// validateRecordUserEvent rejects anything the log would store wrongly rather
// than normalising it. An optional field that is present must be non-empty:
// an empty platform_user_id would otherwise read as a viewer with no id
// instead of an event attributed to nobody.
func validateRecordUserEvent(req *client.RecordUserEventRequest) error {
	required := []struct {
		name   string
		value  string
		maxLen int
	}{
		{"event_id", req.EventId, userEventIDMaxLen},
		{"source", req.Source, userEventSourceMaxLen},
		{"event_type", req.EventType, userEventTypeMaxLen},
		{"platform", req.Platform, userEventPlatformMaxLen},
	}
	for _, field := range required {
		if field.value == "" {
			return twirp.RequiredArgumentError(field.name)
		}
		if len(field.value) > field.maxLen {
			return twirp.InvalidArgumentError(field.name, fmt.Sprintf("must be at most %d bytes", field.maxLen))
		}
	}

	optional := []struct {
		name   string
		value  *string
		maxLen int
	}{
		{"platform_user_id", req.PlatformUserId, userEventUserIDMaxLen},
		{"user_name", req.UserName, userEventUserNameMaxLen},
		{"session_id", req.SessionId, userEventSessionIDMaxLen},
	}
	for _, field := range optional {
		if field.value == nil {
			continue
		}
		if *field.value == "" {
			return twirp.InvalidArgumentError(field.name, "must be omitted rather than empty")
		}
		if len(*field.value) > field.maxLen {
			return twirp.InvalidArgumentError(field.name, fmt.Sprintf("must be at most %d bytes", field.maxLen))
		}
	}

	if req.Amount != nil && *req.Amount < 0 {
		return twirp.InvalidArgumentError("amount", "must not be negative")
	}
	if req.EventValue != "" && !json.Valid([]byte(req.EventValue)) {
		return twirp.InvalidArgumentError("event_value", "must be valid JSON")
	}
	return nil
}

func userEventToProto(m *models.UserEvent) *client.UserEvent {
	return &client.UserEvent{
		Id:             m.ID.String(),
		EventId:        m.EventID,
		Source:         m.Source,
		EventType:      m.EventType,
		Platform:       m.Platform,
		PlatformUserId: m.PlatformUserID,
		UserName:       m.UserName,
		SessionId:      m.SessionID,
		Amount:         m.Amount,
		EventValue:     m.EventValue,
		OccurredAt:     timestamppb.New(m.OccurredAt),
		CreatedAt:      timestamppb.New(m.CreatedAt),
	}
}
