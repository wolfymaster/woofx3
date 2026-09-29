package services

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
	"google.golang.org/protobuf/types/known/timestamppb"
)

var gaugeWentLive = time.Date(2026, 9, 27, 20, 0, 0, 0, time.UTC)

// newGaugeSvcs runs the real SQLite migration chain, so the constraints and
// timestamp columns are the ones production has. The gauge service's clock is
// fixed well after gaugeWentLive so the future-stamp check does not depend on
// when the test runs.
func newGaugeSvcs(t *testing.T) (client.StreamGaugeService, client.StreamSessionService) {
	t.Helper()
	db := openEmptySQLite(t)
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("sql db: %v", err)
	}
	// Every connection to :memory: is a separate database.
	sqlDB.SetMaxOpenConns(1)
	if err := gormigrate.New(db, gormigrate.DefaultOptions, sqliteChain(t)).Migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	sessionRepo := repo.NewStreamSessionRepository(db)
	gauges := &streamGaugeService{
		gauges:   repo.NewStreamGaugeRepository(db),
		sessions: sessionRepo,
		now:      func() time.Time { return gaugeWentLive.Add(24 * time.Hour) },
	}
	return gauges, NewStreamSessionService(sessionRepo, nil)
}

func goLive(t *testing.T, sessions client.StreamSessionService, at time.Time) string {
	t.Helper()
	ctx := context.Background()
	state, err := sessions.EnsureCurrentStreamSession(ctx, &client.EnsureCurrentStreamSessionRequest{})
	if err != nil {
		t.Fatalf("EnsureCurrentStreamSession: %v", err)
	}
	if _, err := sessions.OpenStreamSessionSegment(ctx, &client.OpenStreamSessionSegmentRequest{
		StreamSessionId: state.Session.Id,
		StartedAt:       timestamppb.New(at),
	}); err != nil {
		t.Fatalf("OpenStreamSessionSegment: %v", err)
	}
	return state.Session.Id
}

func goOffline(t *testing.T, sessions client.StreamSessionService, at time.Time) {
	t.Helper()
	if _, err := sessions.CloseStreamSessionSegment(context.Background(), &client.CloseStreamSessionSegmentRequest{
		EndedAt: timestamppb.New(at),
	}); err != nil {
		t.Fatalf("CloseStreamSessionSegment: %v", err)
	}
}

func viewerSample(at time.Time, viewers int64) *client.RecordStreamGaugeSampleRequest {
	return &client.RecordStreamGaugeSampleRequest{
		SampledAt:   timestamppb.New(at),
		ViewerCount: int64Ptr(viewers),
	}
}

func wantTwirpCode(t *testing.T, err error, want twirp.ErrorCode) {
	t.Helper()
	var twerr twirp.Error
	if !errors.As(err, &twerr) {
		t.Fatalf("err = %v, want a twirp %s", err, want)
	}
	if twerr.Code() != want {
		t.Fatalf("code = %s, want %s (%s)", twerr.Code(), want, twerr.Msg())
	}
}

func TestRecordStreamGaugeSampleStampsTheOpenSegment(t *testing.T) {
	ctx := context.Background()
	gauges, sessions := newGaugeSvcs(t)
	sessionID := goLive(t, sessions, gaugeWentLive)

	resp, err := gauges.RecordStreamGaugeSample(ctx, &client.RecordStreamGaugeSampleRequest{
		SampledAt:        timestamppb.New(gaugeWentLive.Add(5*time.Minute + 37*time.Second)),
		ViewerCount:      int64Ptr(12),
		SubscriberTotal:  int64Ptr(40),
		SubscriberPoints: int64Ptr(52),
	})
	if err != nil {
		t.Fatalf("RecordStreamGaugeSample: %v", err)
	}
	if !resp.Created {
		t.Fatalf("created = false for a new minute")
	}
	sample := resp.Sample
	if sample.SessionId != sessionID {
		t.Fatalf("session_id = %s, want %s", sample.SessionId, sessionID)
	}
	if sample.SegmentId == "" {
		t.Fatalf("segment_id is empty")
	}
	if want := gaugeWentLive.Add(5 * time.Minute); !sample.SampledAt.AsTime().Equal(want) {
		t.Fatalf("sampled_at = %v, want the minute %v", sample.SampledAt.AsTime(), want)
	}

	listed, err := gauges.ListStreamGaugeSamples(ctx, &client.ListStreamGaugeSamplesRequest{StreamSessionId: sessionID})
	if err != nil {
		t.Fatalf("ListStreamGaugeSamples: %v", err)
	}
	if len(listed.Samples) != 1 {
		t.Fatalf("samples = %d, want 1", len(listed.Samples))
	}
	read := listed.Samples[0]
	if read.ViewerCount == nil || *read.ViewerCount != 12 {
		t.Fatalf("viewer_count = %v, want 12", read.ViewerCount)
	}
	if read.FollowerTotal != nil {
		t.Fatalf("follower_total = %d, want absent: its read failed, which is not zero", *read.FollowerTotal)
	}
	if read.SubscriberTotal == nil || *read.SubscriberTotal != 40 || read.SubscriberPoints == nil || *read.SubscriberPoints != 52 {
		t.Fatalf("subscriber total/points = %v/%v, want 40/52", read.SubscriberTotal, read.SubscriberPoints)
	}
	if !read.SampledAt.AsTime().Equal(sample.SampledAt.AsTime()) {
		t.Fatalf("read sampled_at = %v, want %v", read.SampledAt.AsTime(), sample.SampledAt.AsTime())
	}
}

func TestRecordStreamGaugeSampleKeepsTheFirstSampleOfAMinute(t *testing.T) {
	ctx := context.Background()
	gauges, sessions := newGaugeSvcs(t)
	goLive(t, sessions, gaugeWentLive)

	first, err := gauges.RecordStreamGaugeSample(ctx, viewerSample(gaugeWentLive.Add(time.Minute+5*time.Second), 10))
	if err != nil {
		t.Fatalf("first RecordStreamGaugeSample: %v", err)
	}
	second, err := gauges.RecordStreamGaugeSample(ctx, viewerSample(gaugeWentLive.Add(time.Minute+50*time.Second), 99))
	if err != nil {
		t.Fatalf("second RecordStreamGaugeSample: %v", err)
	}
	if second.Created {
		t.Fatalf("created = true for a minute already sampled")
	}
	if second.Sample.Id != first.Sample.Id || *second.Sample.ViewerCount != 10 {
		t.Fatalf("second call returned %s with %d viewers, want the stored %s with 10",
			second.Sample.Id, *second.Sample.ViewerCount, first.Sample.Id)
	}
}

func TestRecordStreamGaugeSampleRefusesWhenNotLive(t *testing.T) {
	ctx := context.Background()
	gauges, sessions := newGaugeSvcs(t)

	_, err := gauges.RecordStreamGaugeSample(ctx, viewerSample(gaugeWentLive, 0))
	wantTwirpCode(t, err, twirp.FailedPrecondition)

	goLive(t, sessions, gaugeWentLive)
	_, err = gauges.RecordStreamGaugeSample(ctx, viewerSample(gaugeWentLive.Add(-time.Second), 5))
	wantTwirpCode(t, err, twirp.FailedPrecondition)

	goOffline(t, sessions, gaugeWentLive.Add(time.Hour))
	_, err = gauges.RecordStreamGaugeSample(ctx, viewerSample(gaugeWentLive.Add(2*time.Hour), 0))
	wantTwirpCode(t, err, twirp.FailedPrecondition)
}

func TestRecordStreamGaugeSampleRejectsMalformedSamples(t *testing.T) {
	ctx := context.Background()
	gauges, sessions := newGaugeSvcs(t)
	goLive(t, sessions, gaugeWentLive)
	at := timestamppb.New(gaugeWentLive.Add(time.Minute))

	cases := map[string]*client.RecordStreamGaugeSampleRequest{
		"no sampled_at": {ViewerCount: int64Ptr(1)},
		"no metric":     {SampledAt: at},
		"negative":      {SampledAt: at, FollowerTotal: int64Ptr(-1)},
		"in the future": viewerSample(gaugeWentLive.Add(48*time.Hour), 1),
		"invalid stamp": {SampledAt: &timestamppb.Timestamp{Seconds: 1, Nanos: -1}, ViewerCount: int64Ptr(1)},
	}
	for name, req := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := gauges.RecordStreamGaugeSample(ctx, req)
			wantTwirpCode(t, err, twirp.InvalidArgument)
		})
	}
}

func TestListStreamGaugeSamplesFollowsSegmentsAcrossASplit(t *testing.T) {
	ctx := context.Background()
	gauges, sessions := newGaugeSvcs(t)

	earlier := goLive(t, sessions, gaugeWentLive)
	if _, err := gauges.RecordStreamGaugeSample(ctx, viewerSample(gaugeWentLive.Add(time.Minute), 10)); err != nil {
		t.Fatalf("RecordStreamGaugeSample: %v", err)
	}
	goOffline(t, sessions, gaugeWentLive.Add(time.Hour))

	split, err := sessions.SplitStreamSession(ctx, &client.SplitStreamSessionRequest{
		At: timestamppb.New(gaugeWentLive.Add(5 * time.Hour)),
	})
	if err != nil {
		t.Fatalf("SplitStreamSession: %v", err)
	}
	later := goLive(t, sessions, gaugeWentLive.Add(5*time.Hour))
	if later != split.Started.Id {
		t.Fatalf("went live in %s, want the split's successor %s", later, split.Started.Id)
	}
	for _, minute := range []time.Duration{3, 1, 2} {
		at := gaugeWentLive.Add(5*time.Hour + minute*time.Minute)
		if _, err := gauges.RecordStreamGaugeSample(ctx, viewerSample(at, int64(minute))); err != nil {
			t.Fatalf("RecordStreamGaugeSample: %v", err)
		}
	}

	first, err := gauges.ListStreamGaugeSamples(ctx, &client.ListStreamGaugeSamplesRequest{StreamSessionId: earlier})
	if err != nil {
		t.Fatalf("ListStreamGaugeSamples(earlier): %v", err)
	}
	if len(first.Samples) != 1 || *first.Samples[0].ViewerCount != 10 {
		t.Fatalf("earlier session samples = %v, want only its own", first.Samples)
	}

	second, err := gauges.ListStreamGaugeSamples(ctx, &client.ListStreamGaugeSamplesRequest{StreamSessionId: later})
	if err != nil {
		t.Fatalf("ListStreamGaugeSamples(later): %v", err)
	}
	if len(second.Samples) != 3 {
		t.Fatalf("later session samples = %d, want 3", len(second.Samples))
	}
	for i, sample := range second.Samples {
		if *sample.ViewerCount != int64(i+1) {
			t.Fatalf("sample %d has %d viewers; samples are not oldest first", i, *sample.ViewerCount)
		}
	}
}

func TestListStreamGaugeSamplesNamesAMissingSession(t *testing.T) {
	gauges, _ := newGaugeSvcs(t)
	ctx := context.Background()

	_, err := gauges.ListStreamGaugeSamples(ctx, &client.ListStreamGaugeSamplesRequest{})
	wantTwirpCode(t, err, twirp.InvalidArgument)

	_, err = gauges.ListStreamGaugeSamples(ctx, &client.ListStreamGaugeSamplesRequest{StreamSessionId: "not-a-uuid"})
	wantTwirpCode(t, err, twirp.InvalidArgument)

	_, err = gauges.ListStreamGaugeSamples(ctx, &client.ListStreamGaugeSamplesRequest{
		StreamSessionId: "00000000-0000-0000-0000-000000000000",
	})
	wantTwirpCode(t, err, twirp.NotFound)
}
