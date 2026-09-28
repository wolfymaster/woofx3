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

// streamGaugeClockSkew is how far ahead of this process's clock a sample may
// be stamped. The sampler runs in another process; beyond this, a stamp is a
// bug, and storing it would occupy a minute the real sample then cannot take.
const streamGaugeClockSkew = time.Minute

// streamGaugeService implements `client.StreamGaugeService`: the per-minute
// viewer, follower and subscriber levels sampled while the stream is live.
//
// It resolves the open segment itself rather than trusting the caller's idea
// of it, which is what makes "only sampled while a segment is open" a property
// of the table rather than of one sampler's bookkeeping.
//
// Recording publishes nothing to the outbox: nothing reacts to a sample, and
// readers query the table.
type streamGaugeService struct {
	gauges   *repo.StreamGaugeRepository
	sessions *repo.StreamSessionRepository
	now      func() time.Time
}

func NewStreamGaugeService(
	gaugeRepo *repo.StreamGaugeRepository,
	sessionRepo *repo.StreamSessionRepository,
) client.StreamGaugeService {
	return &streamGaugeService{
		gauges:   gaugeRepo,
		sessions: sessionRepo,
		now:      func() time.Time { return time.Now().UTC() },
	}
}

func (s *streamGaugeService) RecordStreamGaugeSample(ctx context.Context, req *client.RecordStreamGaugeSampleRequest) (*client.RecordStreamGaugeSampleResponse, error) {
	if err := validateRecordStreamGaugeSample(req, s.now()); err != nil {
		return nil, err
	}
	sampledAt := req.SampledAt.AsTime().UTC()

	segment, err := s.sessions.GetOpenSegment()
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, twirp.NewError(twirp.FailedPrecondition, "no stream segment is open; gauges are sampled only while live")
		}
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to load the open segment: %w", err))
	}
	if sampledAt.Before(segment.StartedAt) {
		return nil, twirp.NewError(twirp.FailedPrecondition, "sampled_at is before the open segment started")
	}

	sample := &models.StreamGaugeSample{
		ID:               uuid.New(),
		SegmentID:        segment.ID,
		SessionID:        segment.StreamSessionID,
		SampledAt:        sampledAt.Truncate(time.Minute),
		ViewerCount:      req.ViewerCount,
		FollowerTotal:    req.FollowerTotal,
		SubscriberTotal:  req.SubscriberTotal,
		SubscriberPoints: req.SubscriberPoints,
		CreatedAt:        s.now(),
	}
	stored, created, err := s.gauges.Record(sample)
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to record gauge sample: %w", err))
	}

	message := "Gauge sample recorded"
	if !created {
		message = "Gauge sample already recorded for this minute"
	}
	return &client.RecordStreamGaugeSampleResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: message,
		},
		Sample:  streamGaugeSampleToProto(stored),
		Created: created,
	}, nil
}

func (s *streamGaugeService) ListStreamGaugeSamples(ctx context.Context, req *client.ListStreamGaugeSamplesRequest) (*client.ListStreamGaugeSamplesResponse, error) {
	if req.StreamSessionId == "" {
		return nil, twirp.RequiredArgumentError("stream_session_id")
	}
	sessionID, err := uuid.Parse(req.StreamSessionId)
	if err != nil {
		return nil, twirp.InvalidArgumentError("stream_session_id", "invalid UUID format")
	}
	// A session a merge removed has no samples either, but "gone" and "never
	// sampled" are different answers to the reader.
	if _, err := s.sessions.GetSessionByID(sessionID); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, twirp.NotFoundError("stream session not found")
		}
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to load stream session: %w", err))
	}

	samples, err := s.gauges.ListForSession(sessionID)
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("failed to list gauge samples: %w", err))
	}
	out := make([]*client.StreamGaugeSample, 0, len(samples))
	for _, sample := range samples {
		out = append(out, streamGaugeSampleToProto(sample))
	}
	return &client.ListStreamGaugeSamplesResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Gauge samples retrieved successfully",
		},
		Samples: out,
	}, nil
}

// validateRecordStreamGaugeSample rejects a sample with no metric: a row that
// says nothing would read as "sampled" and hide that every read failed.
func validateRecordStreamGaugeSample(req *client.RecordStreamGaugeSampleRequest, now time.Time) error {
	if req.SampledAt == nil {
		return twirp.RequiredArgumentError("sampled_at")
	}
	if err := req.SampledAt.CheckValid(); err != nil {
		return twirp.InvalidArgumentError("sampled_at", err.Error())
	}
	if req.SampledAt.AsTime().After(now.Add(streamGaugeClockSkew)) {
		return twirp.InvalidArgumentError("sampled_at", "must not be in the future")
	}

	metrics := []struct {
		name  string
		value *int64
	}{
		{"viewer_count", req.ViewerCount},
		{"follower_total", req.FollowerTotal},
		{"subscriber_total", req.SubscriberTotal},
		{"subscriber_points", req.SubscriberPoints},
	}
	present := 0
	for _, metric := range metrics {
		if metric.value == nil {
			continue
		}
		if *metric.value < 0 {
			return twirp.InvalidArgumentError(metric.name, "must not be negative")
		}
		present++
	}
	if present == 0 {
		return twirp.InvalidArgumentError("viewer_count", "a sample needs at least one metric")
	}
	return nil
}

func streamGaugeSampleToProto(m *models.StreamGaugeSample) *client.StreamGaugeSample {
	return &client.StreamGaugeSample{
		Id:               m.ID.String(),
		SegmentId:        m.SegmentID.String(),
		SessionId:        m.SessionID.String(),
		SampledAt:        timestamppb.New(m.SampledAt),
		ViewerCount:      m.ViewerCount,
		FollowerTotal:    m.FollowerTotal,
		SubscriberTotal:  m.SubscriberTotal,
		SubscriberPoints: m.SubscriberPoints,
		CreatedAt:        timestamppb.New(m.CreatedAt),
	}
}
