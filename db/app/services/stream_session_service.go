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

// streamSessionService implements `client.StreamSessionService`.
//
// It persists what the engine's extend-or-split policy decides and holds no
// policy of its own: no grace window, no notion of what "recently" means. That
// split is deliberate -- the rule is expected to change, and changing it should
// not mean touching storage.
//
// Outbox publishing is opt-in via `publisher`, matching `alertService`.
type streamSessionService struct {
	repo      *repo.StreamSessionRepository
	publisher *workers.EventPublisher
}

func NewStreamSessionService(
	streamSessionRepo *repo.StreamSessionRepository,
	publisher *workers.EventPublisher,
) client.StreamSessionService {
	return &streamSessionService{
		repo:      streamSessionRepo,
		publisher: publisher,
	}
}

func (s *streamSessionService) EnsureCurrentStreamSession(ctx context.Context, req *client.EnsureCurrentStreamSessionRequest) (*client.StreamSessionStateResponse, error) {
	session, created, err := s.repo.EnsureOpenSession(time.Now().UTC())
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to ensure stream session: %w", err))
	}
	if created {
		s.publishSessionChange(session, "created")
	}

	isSegmentOpen, err := s.isSegmentOpen()
	if err != nil {
		return nil, err
	}
	lastSegmentEndedAt, err := s.lastSegmentEndedAt(session.ID)
	if err != nil {
		return nil, err
	}

	return &client.StreamSessionStateResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Stream session state retrieved successfully",
		},
		Session:            sessionToProto(session),
		IsSegmentOpen:      isSegmentOpen,
		LastSegmentEndedAt: lastSegmentEndedAt,
	}, nil
}

func (s *streamSessionService) SplitStreamSession(ctx context.Context, req *client.SplitStreamSessionRequest) (*client.SplitStreamSessionResponse, error) {
	ended, started, err := s.repo.SplitSession(sessionTimeOrNow(req.At))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, twirp.NotFoundError("no open stream session to split")
		}
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to split stream session: %w", err))
	}

	s.publishSessionChange(ended, "updated")
	s.publishSessionChange(started, "created")

	return &client.SplitStreamSessionResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Stream session split successfully",
		},
		Ended:   sessionToProto(ended),
		Started: sessionToProto(started),
	}, nil
}

func (s *streamSessionService) OpenStreamSessionSegment(ctx context.Context, req *client.OpenStreamSessionSegmentRequest) (*client.StreamSessionSegmentResponse, error) {
	if req.StreamSessionId == "" {
		return nil, twirp.RequiredArgumentError("stream_session_id")
	}
	streamSessionID, err := uuid.Parse(req.StreamSessionId)
	if err != nil {
		return nil, twirp.InvalidArgumentError("stream_session_id", "invalid UUID format")
	}

	segment, err := s.repo.OpenSegment(streamSessionID, sessionTimeOrNow(req.StartedAt))
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to open stream session segment: %w", err))
	}

	return &client.StreamSessionSegmentResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Stream session segment opened successfully",
		},
		Segment: segmentToProto(segment),
	}, nil
}

func (s *streamSessionService) CloseStreamSessionSegment(ctx context.Context, req *client.CloseStreamSessionSegmentRequest) (*client.StreamSessionSegmentResponse, error) {
	segment, err := s.repo.CloseOpenSegment(sessionTimeOrNow(req.EndedAt))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, twirp.NotFoundError("no open stream session segment")
		}
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to close stream session segment: %w", err))
	}

	return &client.StreamSessionSegmentResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Stream session segment closed successfully",
		},
		Segment: segmentToProto(segment),
	}, nil
}

func (s *streamSessionService) GetStreamSession(ctx context.Context, req *client.GetStreamSessionRequest) (*client.StreamSessionResponse, error) {
	id, err := uuid.Parse(req.Id)
	if err != nil {
		return nil, twirp.InvalidArgumentError("id", "invalid UUID format")
	}
	session, err := s.repo.GetSessionByID(id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, twirp.NotFoundError("stream session not found")
		}
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to load stream session: %w", err))
	}
	return &client.StreamSessionResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Stream session retrieved successfully",
		},
		Session: sessionToProto(session),
	}, nil
}

func (s *streamSessionService) ListStreamSessions(ctx context.Context, req *client.ListStreamSessionsRequest) (*client.ListStreamSessionsResponse, error) {
	limit := int(req.Limit)
	offset := int(req.Offset)
	if limit <= 0 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}

	sessions, err := s.repo.ListSessions(limit, offset)
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to list stream sessions: %w", err))
	}
	total, err := s.repo.CountSessions()
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to count stream sessions: %w", err))
	}

	out := make([]*client.StreamSession, len(sessions))
	for i, session := range sessions {
		out[i] = sessionToProto(session)
	}

	return &client.ListStreamSessionsResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Stream sessions retrieved successfully",
		},
		Sessions:   out,
		TotalCount: total,
		Limit:      int32(limit),
		Offset:     int32(offset),
	}, nil
}

func (s *streamSessionService) isSegmentOpen() (bool, error) {
	if _, err := s.repo.GetOpenSegment(); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, nil
		}
		return false, twirp.InternalErrorWith(fmt.Errorf("failed to read open segment: %w", err))
	}
	return true, nil
}

// lastSegmentEndedAt is nil when the session has never been live. That is a
// different state from "went offline long ago", and the two must not be
// conflated: a zero timestamp would read as 1970 and split every session on the
// first `stream.online`.
func (s *streamSessionService) lastSegmentEndedAt(streamSessionID uuid.UUID) (*timestamppb.Timestamp, error) {
	segment, err := s.repo.LastEndedSegment(streamSessionID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to read last stream session segment: %w", err))
	}
	if segment.EndedAt == nil {
		return nil, nil
	}
	return timestamppb.New(*segment.EndedAt), nil
}

// sessionTimeOrNow lets a caller stamp from an event's own time, falling back
// to server time rather than to the zero instant when the field is absent.
func sessionTimeOrNow(ts *timestamppb.Timestamp) time.Time {
	if ts == nil {
		return time.Now().UTC()
	}
	return ts.AsTime().UTC()
}

func sessionToProto(m *models.StreamSession) *client.StreamSession {
	out := &client.StreamSession{
		Id:        m.ID.String(),
		Status:    m.Status,
		StartedAt: timestamppb.New(m.StartedAt),
		CreatedAt: timestamppb.New(m.CreatedAt),
		UpdatedAt: timestamppb.New(m.UpdatedAt),
	}
	if m.EndedAt != nil {
		out.EndedAt = timestamppb.New(*m.EndedAt)
	}
	return out
}

func segmentToProto(m *models.StreamSessionSegment) *client.StreamSessionSegment {
	out := &client.StreamSessionSegment{
		Id:              m.ID.String(),
		StreamSessionId: m.StreamSessionID.String(),
		StartedAt:       timestamppb.New(m.StartedAt),
		CreatedAt:       timestamppb.New(m.CreatedAt),
		UpdatedAt:       timestamppb.New(m.UpdatedAt),
	}
	if m.EndedAt != nil {
		out.EndedAt = timestamppb.New(*m.EndedAt)
	}
	return out
}

func (s *streamSessionService) publishSessionChange(session *models.StreamSession, op string) {
	if s.publisher == nil {
		return
	}
	s.publisher.Publish(workers.PublishOptions{
		EntityType:      "stream_session",
		EntityID:        session.ID.String(),
		Operation:       op,
		Data:            buildStreamSessionChangeData(session),
		AutoAcknowledge: true,
	})
}

func buildStreamSessionChangeData(session *models.StreamSession) map[string]interface{} {
	out := map[string]interface{}{
		"id":         session.ID.String(),
		"status":     session.Status,
		"started_at": session.StartedAt.Format("2006-01-02T15:04:05.000Z07:00"),
		"created_at": session.CreatedAt.Format("2006-01-02T15:04:05.000Z07:00"),
		"updated_at": session.UpdatedAt.Format("2006-01-02T15:04:05.000Z07:00"),
	}
	if session.EndedAt != nil {
		out["ended_at"] = session.EndedAt.Format("2006-01-02T15:04:05.000Z07:00")
	}
	return out
}
