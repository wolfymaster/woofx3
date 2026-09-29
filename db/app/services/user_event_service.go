package services

import (
	"context"
	"encoding/json"
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
	repo     *repo.UserEventRepository
	sessions *repo.StreamSessionRepository
}

func NewUserEventService(
	userEventRepo *repo.UserEventRepository,
	sessionRepo *repo.StreamSessionRepository,
) client.UserEventService {
	return &userEventService{repo: userEventRepo, sessions: sessionRepo}
}

const (
	leaderboardDefaultLimit = 10
	leaderboardMaxLimit     = 100
)

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

func (s *userEventService) GetStreamSessionEventTotals(ctx context.Context, req *client.GetStreamSessionEventTotalsRequest) (*client.GetStreamSessionEventTotalsResponse, error) {
	window, err := s.sessionWindow("stream_session_id", req.StreamSessionId)
	if err != nil {
		return nil, err
	}
	totals, err := s.repo.Totals(*window)
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to total user events: %w", err))
	}
	return &client.GetStreamSessionEventTotalsResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Stream session totals retrieved successfully",
		},
		Totals: &client.StreamSessionEventTotals{
			Bits:       totals.Bits,
			Cheers:     totals.Cheers,
			Subs:       totals.Subs,
			GiftedSubs: totals.GiftedSubs,
			Follows:    totals.Follows,
			Raids:      totals.Raids,
			Raiders:    totals.Raiders,
		},
	}, nil
}

func (s *userEventService) GetViewerEventTotals(ctx context.Context, req *client.GetViewerEventTotalsRequest) (*client.GetViewerEventTotalsResponse, error) {
	if req.Platform == "" {
		return nil, twirp.RequiredArgumentError("platform")
	}
	if req.PlatformUserId == "" {
		return nil, twirp.RequiredArgumentError("platform_user_id")
	}
	window, err := s.optionalSessionWindow(req.StreamSessionId)
	if err != nil {
		return nil, err
	}
	totals, err := s.repo.ViewerTotals(req.Platform, req.PlatformUserId, window)
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to total viewer events: %w", err))
	}
	return &client.GetViewerEventTotalsResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Viewer totals retrieved successfully",
		},
		Totals: &client.ViewerEventTotals{
			Platform:       req.Platform,
			PlatformUserId: req.PlatformUserId,
			UserName:       totals.UserName,
			Bits:           totals.Bits,
			Cheers:         totals.Cheers,
			GiftedSubs:     totals.GiftedSubs,
			Gifts:          totals.Gifts,
		},
	}, nil
}

func (s *userEventService) ListViewerLeaderboard(ctx context.Context, req *client.ListViewerLeaderboardRequest) (*client.ListViewerLeaderboardResponse, error) {
	var eventType string
	switch req.Metric {
	case client.LeaderboardMetric_LEADERBOARD_METRIC_BITS:
		eventType = models.UserEventTypeCheer
	case client.LeaderboardMetric_LEADERBOARD_METRIC_GIFTED_SUBS:
		eventType = models.UserEventTypeSubscriptionGift
	default:
		return nil, twirp.InvalidArgumentError("metric", "must be bits or gifted subs")
	}

	minTotal := int64(1)
	if req.MinTotal != nil {
		if *req.MinTotal < 1 {
			return nil, twirp.InvalidArgumentError("min_total", "must be at least 1")
		}
		minTotal = *req.MinTotal
	}
	limit := leaderboardDefaultLimit
	if req.Limit != nil {
		if *req.Limit < 1 || *req.Limit > leaderboardMaxLimit {
			return nil, twirp.InvalidArgumentError("limit", fmt.Sprintf("must be from 1 to %d", leaderboardMaxLimit))
		}
		limit = int(*req.Limit)
	}
	window, err := s.optionalSessionWindow(req.StreamSessionId)
	if err != nil {
		return nil, err
	}

	entries, err := s.repo.Leaderboard(eventType, window, minTotal, limit)
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to rank viewers: %w", err))
	}
	out := make([]*client.LeaderboardEntry, 0, len(entries))
	for _, entry := range entries {
		out = append(out, &client.LeaderboardEntry{
			Platform:       entry.Platform,
			PlatformUserId: entry.PlatformUserID,
			UserName:       entry.UserName,
			Total:          entry.Total,
			Events:         entry.Events,
		})
	}
	return &client.ListViewerLeaderboardResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Leaderboard retrieved successfully",
		},
		Entries: out,
	}, nil
}

// sessionWindow resolves a session id to the span of time the session owns:
// from its start until the session that replaced it began, or to the present
// while it is open. Splits close one session and open the next at the same
// instant, so sessions tile time and every event falls in exactly one window.
//
// This is how an event is attributed to its canonical session. The stamp on
// the event is not consulted: it names the session that owned the time when
// the event was published, and the session's bounds are the answer now. One
// lookup per read replaces resolving every row, and the window is a range
// scan on user_events' occurred_at index.
func (s *userEventService) sessionWindow(field, id string) (*repo.EventWindow, error) {
	if id == "" {
		return nil, twirp.RequiredArgumentError(field)
	}
	sessionID, err := uuid.Parse(id)
	if err != nil {
		return nil, twirp.InvalidArgumentError(field, "invalid UUID format")
	}
	session, err := s.sessions.GetSessionByID(sessionID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, twirp.NotFoundError("stream session not found")
		}
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to load stream session: %w", err))
	}
	return &repo.EventWindow{From: session.StartedAt, To: session.EndedAt}, nil
}

// optionalSessionWindow is sessionWindow for reads where no session means
// lifetime, which is a nil window.
func (s *userEventService) optionalSessionWindow(id *string) (*repo.EventWindow, error) {
	if id == nil {
		return nil, nil
	}
	return s.sessionWindow("stream_session_id", *id)
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
