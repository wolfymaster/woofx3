package services

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/database"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

// countWindowStart is the first hour of the windows these tests count.
var countWindowStart = time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)

// placeAlert creates an alert and rewrites its status and timestamps, which a
// test cannot otherwise choose: the repository stamps them with its own clock.
func placeAlert(t *testing.T, svc client.AlertService, db *gorm.DB, status string, createdAt, updatedAt time.Time) {
	t.Helper()
	row := createAlert(t, svc, "env-"+status+"-"+createdAt.Format(time.RFC3339Nano))
	stamp := func(at time.Time) interface{} {
		if database.Dialect(db.Dialector.Name()) == database.DialectPostgres {
			return at.UTC()
		}
		return at.UTC().Format(database.SQLiteTimestampLayout)
	}
	if err := db.Exec(`UPDATE alerts SET status = ?, created_at = ?, updated_at = ? WHERE id = ?`,
		status, stamp(createdAt), stamp(updatedAt), row.Id).Error; err != nil {
		t.Fatalf("place alert: %v", err)
	}
}

func countRequest(since time.Time, hours int32, unconfirmedBefore time.Time) *client.CountAlertsByHourRequest {
	return &client.CountAlertsByHourRequest{
		Since:             timestamppb.New(since),
		Hours:             hours,
		UnconfirmedBefore: timestamppb.New(unconfirmedBefore),
	}
}

func TestCountAlertsByHourCountsEachHourByStatusAndConfirmation(t *testing.T) {
	forEachAlertDialect(t, func(t *testing.T, svc client.AlertService, db *gorm.DB) {
		hour := func(h int, minutes int) time.Time {
			return countWindowStart.Add(time.Duration(h)*time.Hour + time.Duration(minutes)*time.Minute)
		}
		unconfirmedBefore := hour(2, 30)

		// Before and after the window: not counted.
		placeAlert(t, svc, db, "completed", hour(0, 0).Add(-time.Microsecond), hour(0, 0))
		placeAlert(t, svc, db, "completed", hour(3, 0), hour(3, 0))
		// Hour 0, from its first instant.
		placeAlert(t, svc, db, "completed", hour(0, 0), hour(0, 1))
		placeAlert(t, svc, db, "completed", hour(0, 10), hour(0, 11))
		placeAlert(t, svc, db, "failed", hour(0, 59), hour(1, 0))
		// Hour 1: an unsettled alert nothing reported on is unconfirmed; a settled one never is.
		placeAlert(t, svc, db, "playing", hour(1, 0), hour(1, 1))
		placeAlert(t, svc, db, "timed_out", hour(1, 5), hour(1, 6))
		// Hour 2, up to its last instant: unsettled and written since the bound, so still on its way.
		placeAlert(t, svc, db, "sent", hour(3, 0).Add(-time.Microsecond), hour(2, 45))

		resp, err := svc.CountAlertsByHour(context.Background(), countRequest(countWindowStart, 3, unconfirmedBefore))
		if err != nil {
			t.Fatalf("CountAlertsByHour: %v", err)
		}
		want := []*client.AlertHourCount{
			{Hour: 0, Status: "completed", Count: 2},
			{Hour: 0, Status: "failed", Count: 1},
			{Hour: 1, Status: "playing", Unconfirmed: true, Count: 1},
			{Hour: 1, Status: "timed_out", Count: 1},
			{Hour: 2, Status: "sent", Count: 1},
		}
		if len(resp.Counts) != len(want) {
			t.Fatalf("got %d counts %v, want %v", len(resp.Counts), resp.Counts, want)
		}
		for i, got := range resp.Counts {
			w := want[i]
			if got.Hour != w.Hour || got.Status != w.Status || got.Unconfirmed != w.Unconfirmed || got.Count != w.Count {
				t.Fatalf("count %d = %v, want %v", i, got, w)
			}
		}
	})
}

func TestCountAlertsByHourWithNoAlertsIsEmpty(t *testing.T) {
	forEachAlertDialect(t, func(t *testing.T, svc client.AlertService, _ *gorm.DB) {
		resp, err := svc.CountAlertsByHour(context.Background(), countRequest(countWindowStart, 24, countWindowStart))
		if err != nil {
			t.Fatalf("CountAlertsByHour: %v", err)
		}
		if resp.Counts == nil || len(resp.Counts) != 0 {
			t.Fatalf("counts = %v, want an empty list", resp.Counts)
		}
	})
}

func TestCountAlertsByHourRefusesAnInvalidWindow(t *testing.T) {
	forEachAlertDialect(t, func(t *testing.T, svc client.AlertService, _ *gorm.DB) {
		valid := func() *client.CountAlertsByHourRequest {
			return countRequest(countWindowStart, 24, countWindowStart)
		}
		tests := []struct {
			name     string
			mutate   func(req *client.CountAlertsByHourRequest)
			wantCode twirp.ErrorCode
		}{
			{"no since", func(req *client.CountAlertsByHourRequest) { req.Since = nil }, twirp.InvalidArgument},
			{"a since off the hour", func(req *client.CountAlertsByHourRequest) {
				req.Since = timestamppb.New(countWindowStart.Add(time.Minute))
			}, twirp.InvalidArgument},
			{"no hours", func(req *client.CountAlertsByHourRequest) { req.Hours = 0 }, twirp.InvalidArgument},
			{"more than a week", func(req *client.CountAlertsByHourRequest) { req.Hours = 169 }, twirp.InvalidArgument},
			{"no unconfirmed bound", func(req *client.CountAlertsByHourRequest) { req.UnconfirmedBefore = nil }, twirp.InvalidArgument},
		}
		for _, tc := range tests {
			t.Run(tc.name, func(t *testing.T) {
				req := valid()
				tc.mutate(req)
				_, err := svc.CountAlertsByHour(context.Background(), req)
				var twerr twirp.Error
				if !errors.As(err, &twerr) || twerr.Code() != tc.wantCode {
					t.Fatalf("err = %v, want %s", err, tc.wantCode)
				}
			})
		}
		if _, err := svc.CountAlertsByHour(context.Background(), countRequest(countWindowStart, 168, countWindowStart)); err != nil {
			t.Fatalf("a week is refused: %v", err)
		}
	})
}
