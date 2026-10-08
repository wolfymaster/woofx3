package services

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"regexp"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/app/workers"
	"github.com/wolfymaster/woofx3/db/database/models"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
	"gorm.io/gorm"
)

// newAlertSvc publishes to the outbox table of a fully migrated database, so
// a test reads back exactly the snapshots the api would project to callbacks.
func newAlertSvc(t *testing.T, db *gorm.DB) client.AlertService {
	t.Helper()
	// The outbox row's id comes from a Postgres column default that the
	// SQLite schema lacks, so the test supplies one.
	err := db.Callback().Create().Before("gorm:create").Register("test:worker_event_id", func(tx *gorm.DB) {
		if event, ok := tx.Statement.Dest.(*models.WorkerEvent); ok && event.ID == "" {
			event.ID = uuid.NewString()
		}
	})
	if err != nil {
		t.Fatalf("register outbox id callback: %v", err)
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	publisher := workers.NewEventPublisher(repo.NewDbEventRepository(db), logger)
	return NewAlertService(repo.NewAlertRepository(db), publisher)
}

// forEachAlertDialect runs an alert test against SQLite and, when configured,
// Postgres: each spells the forward-only UPDATE, the row lock and the clock
// differently.
func forEachAlertDialect(t *testing.T, test func(t *testing.T, svc client.AlertService, db *gorm.DB)) {
	t.Helper()
	forEachDialect(t, func(t *testing.T, db *gorm.DB) {
		test(t, newAlertSvc(t, db), db)
	})
}

// publishedAlerts returns the alert snapshots in the outbox, oldest first.
func publishedAlerts(t *testing.T, db *gorm.DB) []map[string]interface{} {
	t.Helper()
	var events []models.WorkerEvent
	if err := db.Where("entity_type = ?", "alert").Order("created_at").Find(&events).Error; err != nil {
		t.Fatalf("read outbox: %v", err)
	}
	out := make([]map[string]interface{}, len(events))
	for i, event := range events {
		if err := json.Unmarshal([]byte(event.Payload), &out[i]); err != nil {
			t.Fatalf("outbox payload: %v", err)
		}
	}
	return out
}

func createAlert(t *testing.T, svc client.AlertService, envelopeID string) *client.Alert {
	t.Helper()
	resp, err := svc.CreateAlert(context.Background(), &client.CreateAlertRequest{
		Payload:    `{"id":"` + envelopeID + `"}`,
		EnvelopeId: envelopeID,
	})
	if err != nil {
		t.Fatalf("CreateAlert: %v", err)
	}
	return resp.Alert
}

func moveAlertWithError(t *testing.T, svc client.AlertService, envelopeID, status, errorMsg string) *client.Alert {
	t.Helper()
	resp, err := svc.UpdateAlertLifecycle(context.Background(), &client.UpdateAlertLifecycleRequest{
		EnvelopeId: envelopeID,
		Status:     status,
		Error:      errorMsg,
	})
	if err != nil {
		t.Fatalf("UpdateAlertLifecycle(%s): %v", status, err)
	}
	return resp.Alert
}

func moveAlert(t *testing.T, svc client.AlertService, envelopeID, status string) *client.Alert {
	t.Helper()
	return moveAlertWithError(t, svc, envelopeID, status, "")
}

func replayAlert(t *testing.T, svc client.AlertService, id string) *client.Alert {
	t.Helper()
	resp, err := svc.UpdateAlertStatus(context.Background(), &client.UpdateAlertStatusRequest{
		Id:     id,
		Status: "replayed",
	})
	if err != nil {
		t.Fatalf("UpdateAlertStatus: %v", err)
	}
	return resp.Alert
}

func storedAlert(t *testing.T, db *gorm.DB, id string) *models.Alert {
	t.Helper()
	var alert models.Alert
	if err := db.Where("id = ?", id).First(&alert).Error; err != nil {
		t.Fatalf("read alert: %v", err)
	}
	return &alert
}

type publishedStep struct {
	status  string
	version float64
}

func assertPublished(t *testing.T, db *gorm.DB, want []publishedStep) {
	t.Helper()
	snapshots := publishedAlerts(t, db)
	got := make([]publishedStep, len(snapshots))
	for i, snapshot := range snapshots {
		got[i] = publishedStep{status: snapshot["status"].(string), version: snapshot["version"].(float64)}
	}
	if len(got) != len(want) {
		t.Fatalf("published %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("published %v, want %v", got, want)
		}
	}
}

func assertUnchanged(t *testing.T, before, after *models.Alert) {
	t.Helper()
	if after.Status != before.Status || after.Version != before.Version || !after.UpdatedAt.Equal(before.UpdatedAt) ||
		after.Error != before.Error {
		t.Fatalf("refused writes changed the row: %s v%d %v %q, was %s v%d %v %q",
			after.Status, after.Version, after.UpdatedAt, after.Error,
			before.Status, before.Version, before.UpdatedAt, before.Error)
	}
}

func TestAlertLifecycleMovesForwardAndVersionsEachWrite(t *testing.T) {
	forEachAlertDialect(t, func(t *testing.T, svc client.AlertService, db *gorm.DB) {
		created := createAlert(t, svc, "env-1")

		moveAlert(t, svc, "env-1", "dispatched")
		moveAlert(t, svc, "env-1", "playing")
		moveAlert(t, svc, "env-1", "completed")

		assertPublished(t, db, []publishedStep{{"sent", 1}, {"dispatched", 2}, {"playing", 3}, {"completed", 4}})
		stored := storedAlert(t, db, created.Id)
		if stored.Version != 4 || stored.Status != "completed" {
			t.Fatalf("stored = %s v%d, want completed v4", stored.Status, stored.Version)
		}
		if stored.PlayedAt == nil || stored.CompletedAt == nil || stored.CompletedAt.Before(*stored.PlayedAt) {
			t.Fatalf("played_at = %v, completed_at = %v, want both set in order", stored.PlayedAt, stored.CompletedAt)
		}
	})
}

func TestAlertLifecycleRefusesBackwardAndRepeatedTransitionsWithoutPublishing(t *testing.T) {
	forEachAlertDialect(t, func(t *testing.T, svc client.AlertService, db *gorm.DB) {
		created := createAlert(t, svc, "env-1")
		moveAlert(t, svc, "env-1", "playing")
		moveAlert(t, svc, "env-1", "completed")
		before := storedAlert(t, db, created.Id)

		// A second widget starting the alert after the first finished, the
		// same verdict reported again by another widget, and a dispatch
		// arriving late.
		for _, status := range []string{"playing", "completed", "dispatched"} {
			if got := moveAlert(t, svc, "env-1", status); got.Status != "completed" {
				t.Fatalf("refused %s returned status %s, want the row as it is", status, got.Status)
			}
		}

		assertPublished(t, db, []publishedStep{{"sent", 1}, {"playing", 2}, {"completed", 3}})
		assertUnchanged(t, before, storedAlert(t, db, created.Id))
	})
}

func TestAlertLifecycleKeepsTheFirstVerdict(t *testing.T) {
	verdicts := []string{"completed", "failed", "skipped", "timed_out"}
	for _, first := range verdicts {
		for _, second := range verdicts {
			if first == "timed_out" && second != "timed_out" {
				continue
			}
			t.Run(first+" then "+second, func(t *testing.T) {
				forEachAlertDialect(t, func(t *testing.T, svc client.AlertService, db *gorm.DB) {
					created := createAlert(t, svc, "env-1")
					moveAlertWithError(t, svc, "env-1", first, "first")
					before := storedAlert(t, db, created.Id)

					got := moveAlertWithError(t, svc, "env-1", second, "second")

					if got.Status != first || got.Error != before.Error {
						t.Fatalf("returned %s %q, want the row as it is (%s %q)",
							got.Status, got.Error, first, before.Error)
					}
					assertPublished(t, db, []publishedStep{{"sent", 1}, {first, 2}})
					assertUnchanged(t, before, storedAlert(t, db, created.Id))
				})
			})
		}
	}
}

func TestAlertLifecycleLetsARealVerdictReplaceATimeout(t *testing.T) {
	cases := []struct {
		verdict   string
		errorMsg  string
		wantError string
	}{
		{"completed", "", ""},
		{"skipped", "", ""},
		{"failed", "autoplay blocked", "autoplay blocked"},
	}
	for _, tc := range cases {
		t.Run(tc.verdict, func(t *testing.T) {
			forEachAlertDialect(t, func(t *testing.T, svc client.AlertService, db *gorm.DB) {
				created := createAlert(t, svc, "env-1")
				moveAlertWithError(t, svc, "env-1", "timed_out", "no ack")
				timedOut := storedAlert(t, db, created.Id)

				moveAlertWithError(t, svc, "env-1", tc.verdict, tc.errorMsg)

				assertPublished(t, db, []publishedStep{{"sent", 1}, {"timed_out", 2}, {tc.verdict, 3}})
				replaced := storedAlert(t, db, created.Id)
				if replaced.Error != tc.wantError {
					t.Fatalf("error = %q, want %q", replaced.Error, tc.wantError)
				}
				if replaced.CompletedAt == nil || !replaced.CompletedAt.Equal(*timedOut.CompletedAt) {
					t.Fatalf("completed_at = %v, want the timeout's %v", replaced.CompletedAt, timedOut.CompletedAt)
				}
				// The real verdict is final: nothing replaces it.
				moveAlert(t, svc, "env-1", "completed")
				moveAlertWithError(t, svc, "env-1", "timed_out", "no ack")
				assertPublished(t, db, []publishedStep{{"sent", 1}, {"timed_out", 2}, {tc.verdict, 3}})
			})
		})
	}
}

func TestAlertLifecycleAppliesOneOfConcurrentVerdicts(t *testing.T) {
	forEachAlertDialect(t, func(t *testing.T, svc client.AlertService, db *gorm.DB) {
		createAlert(t, svc, "env-1")
		verdicts := []string{"completed", "failed", "skipped", "completed", "failed", "skipped"}
		var wg sync.WaitGroup
		errs := make(chan error, len(verdicts))
		for _, verdict := range verdicts {
			wg.Add(1)
			go func() {
				defer wg.Done()
				_, err := svc.UpdateAlertLifecycle(context.Background(), &client.UpdateAlertLifecycleRequest{
					EnvelopeId: "env-1",
					Status:     verdict,
				})
				errs <- err
			}()
		}
		wg.Wait()
		close(errs)
		for err := range errs {
			if err != nil {
				t.Fatalf("UpdateAlertLifecycle: %v", err)
			}
		}

		snapshots := publishedAlerts(t, db)
		if len(snapshots) != 2 || snapshots[1]["version"].(float64) != 2 {
			t.Fatalf("published %d snapshots, want the created row and exactly one verdict at v2", len(snapshots))
		}
	})
}

func TestAlertReplayedRowRefusesLaterLifecycleWrites(t *testing.T) {
	forEachAlertDialect(t, func(t *testing.T, svc client.AlertService, db *gorm.DB) {
		created := createAlert(t, svc, "env-1")
		replayAlert(t, svc, created.Id)

		moveAlert(t, svc, "env-1", "completed")

		assertPublished(t, db, []publishedStep{{"sent", 1}, {"replayed", 2}})
	})
}

func TestAlertReplayAppliesAfterAVerdictButOnlyOnce(t *testing.T) {
	forEachAlertDialect(t, func(t *testing.T, svc client.AlertService, db *gorm.DB) {
		created := createAlert(t, svc, "env-1")
		moveAlertWithError(t, svc, "env-1", "failed", "missing media")

		replayAlert(t, svc, created.Id)
		replayed := storedAlert(t, db, created.Id)
		again := replayAlert(t, svc, created.Id)

		if again.Status != "replayed" || !again.UpdatedAt.AsTime().Equal(replayed.UpdatedAt) {
			t.Fatalf("second replay returned %s at %v, want the row as it is (replayed at %v)",
				again.Status, again.UpdatedAt.AsTime(), replayed.UpdatedAt)
		}
		assertPublished(t, db, []publishedStep{{"sent", 1}, {"failed", 2}, {"replayed", 3}})
		assertUnchanged(t, replayed, storedAlert(t, db, created.Id))
		if replayed.Error != "missing media" {
			t.Fatalf("error = %q, want the failure reason kept", replayed.Error)
		}
	})
}

func TestAlertStatusRejectsAStatusOutsideTheLifecycle(t *testing.T) {
	forEachAlertDialect(t, func(t *testing.T, svc client.AlertService, db *gorm.DB) {
		created := createAlert(t, svc, "env-1")
		for _, status := range []string{"sent", "pending", "anything"} {
			_, err := svc.UpdateAlertStatus(context.Background(), &client.UpdateAlertStatusRequest{
				Id:     created.Id,
				Status: status,
			})
			twerr, ok := err.(twirp.Error)
			if !ok || twerr.Code() != twirp.InvalidArgument {
				t.Fatalf("%s: err = %v, want invalid_argument", status, err)
			}
		}
		assertPublished(t, db, []publishedStep{{"sent", 1}})
	})
}

func TestAlertStatusForAnUnknownRowIsNotFound(t *testing.T) {
	forEachAlertDialect(t, func(t *testing.T, svc client.AlertService, db *gorm.DB) {
		_, err := svc.UpdateAlertStatus(context.Background(), &client.UpdateAlertStatusRequest{
			Id:     uuid.NewString(),
			Status: "replayed",
		})
		twerr, ok := err.(twirp.Error)
		if !ok || twerr.Code() != twirp.NotFound {
			t.Fatalf("err = %v, want not_found", err)
		}
	})
}

func TestAlertLifecycleForAnUnknownEnvelopeIsNotFound(t *testing.T) {
	forEachAlertDialect(t, func(t *testing.T, svc client.AlertService, db *gorm.DB) {
		_, err := svc.UpdateAlertLifecycle(context.Background(), &client.UpdateAlertLifecycleRequest{
			EnvelopeId: "missing",
			Status:     "playing",
		})
		twerr, ok := err.(twirp.Error)
		if !ok || twerr.Code() != twirp.NotFound {
			t.Fatalf("err = %v, want not_found", err)
		}
	})
}

var nineDigitUTC = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{9}Z$`)

var alertTimestampFields = []string{"created_at", "updated_at", "dispatched_at", "played_at", "completed_at"}

func TestPublishedAlertSnapshotsCarryTheStoredRow(t *testing.T) {
	forEachAlertDialect(t, func(t *testing.T, svc client.AlertService, db *gorm.DB) {
		created := createAlert(t, svc, "env-1")
		createdSnapshot := buildAlertChangeData(storedAlert(t, db, created.Id))
		moveAlert(t, svc, "env-1", "playing")

		snapshots := publishedAlerts(t, db)
		if len(snapshots) != 2 {
			t.Fatalf("published %d snapshots, want 2", len(snapshots))
		}
		stored := buildAlertChangeData(storedAlert(t, db, created.Id))
		for _, field := range alertTimestampFields {
			if snapshots[0][field] != createdSnapshot[field] {
				t.Fatalf("created snapshot %s = %v, stored row formats as %v",
					field, snapshots[0][field], createdSnapshot[field])
			}
			if snapshots[1][field] != stored[field] {
				t.Fatalf("%s = %v, stored row formats as %v", field, snapshots[1][field], stored[field])
			}
		}
		for _, snapshot := range snapshots {
			for _, field := range alertTimestampFields {
				value, present := snapshot[field]
				if present && !nineDigitUTC.MatchString(value.(string)) {
					t.Fatalf("%s = %v, want UTC with nine fractional digits", field, value)
				}
			}
		}
	})
}

func TestAlertWriteStampsEveryColumnWithOneTimestamp(t *testing.T) {
	forEachAlertDialect(t, func(t *testing.T, svc client.AlertService, db *gorm.DB) {
		created := createAlert(t, svc, "env-1")
		row := storedAlert(t, db, created.Id)
		if row.DispatchedAt == nil || !row.CreatedAt.Equal(row.UpdatedAt) || !row.CreatedAt.Equal(*row.DispatchedAt) {
			t.Fatalf("created_at = %v, updated_at = %v, dispatched_at = %v, want one value",
				row.CreatedAt, row.UpdatedAt, row.DispatchedAt)
		}
		if got := created.CreatedAt.AsTime(); !got.Equal(row.CreatedAt) {
			t.Fatalf("CreateAlert returned created_at %v, stored %v", got, row.CreatedAt)
		}

		moveAlert(t, svc, "env-1", "playing")
		row = storedAlert(t, db, created.Id)
		if row.PlayedAt == nil || !row.PlayedAt.Equal(row.UpdatedAt) {
			t.Fatalf("played_at = %v, updated_at = %v, want one value", row.PlayedAt, row.UpdatedAt)
		}
	})
}

func TestBuildAlertChangeDataFormatsEveryTimestampInUTCAtFullPrecision(t *testing.T) {
	zone := time.FixedZone("UTC+2", 2*60*60)
	at := time.Date(2026, 5, 3, 3, 2, 3, 123456000, zone)
	alert := &models.Alert{
		ID:           uuid.New(),
		Version:      3,
		CreatedAt:    at,
		UpdatedAt:    at,
		DispatchedAt: &at,
		PlayedAt:     &at,
		CompletedAt:  &at,
	}

	data := buildAlertChangeData(alert)

	for _, field := range alertTimestampFields {
		if got, want := data[field], "2026-05-03T01:02:03.123456000Z"; got != want {
			t.Fatalf("%s = %v, want %v", field, got, want)
		}
	}
	if data["version"] != int64(3) {
		t.Fatalf("version = %v, want 3", data["version"])
	}
}
