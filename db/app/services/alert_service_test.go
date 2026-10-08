package services

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"regexp"
	"testing"
	"time"

	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/google/uuid"
	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/app/workers"
	"github.com/wolfymaster/woofx3/db/database/models"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
	"gorm.io/gorm"
)

// newAlertSvc runs the real SQLite migration chain and publishes to the
// outbox table, so a test reads back exactly the snapshots the api would
// project to callbacks.
func newAlertSvc(t *testing.T) (client.AlertService, *gorm.DB) {
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
	// The outbox row's id comes from a Postgres column default that the
	// SQLite schema lacks, so the test supplies one.
	err = db.Callback().Create().Before("gorm:create").Register("test:worker_event_id", func(tx *gorm.DB) {
		if event, ok := tx.Statement.Dest.(*models.WorkerEvent); ok && event.ID == "" {
			event.ID = uuid.NewString()
		}
	})
	if err != nil {
		t.Fatalf("register outbox id callback: %v", err)
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	publisher := workers.NewEventPublisher(repo.NewDbEventRepository(db), logger)
	return NewAlertService(repo.NewAlertRepository(db), publisher), db
}

// publishedAlerts returns the alert snapshots in the outbox, oldest first.
func publishedAlerts(t *testing.T, db *gorm.DB) []map[string]interface{} {
	t.Helper()
	var events []models.WorkerEvent
	if err := db.Where("entity_type = ?", "alert").Order("rowid").Find(&events).Error; err != nil {
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

func moveAlert(t *testing.T, svc client.AlertService, envelopeID, status string) *client.Alert {
	t.Helper()
	resp, err := svc.UpdateAlertLifecycle(context.Background(), &client.UpdateAlertLifecycleRequest{
		EnvelopeId: envelopeID,
		Status:     status,
	})
	if err != nil {
		t.Fatalf("UpdateAlertLifecycle(%s): %v", status, err)
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

func TestAlertLifecycleMovesForwardAndVersionsEachWrite(t *testing.T) {
	svc, db := newAlertSvc(t)
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
}

func TestAlertLifecycleRefusesBackwardAndRepeatedTransitionsWithoutPublishing(t *testing.T) {
	svc, db := newAlertSvc(t)
	created := createAlert(t, svc, "env-1")
	moveAlert(t, svc, "env-1", "playing")
	moveAlert(t, svc, "env-1", "completed")
	before := storedAlert(t, db, created.Id)

	// A second widget starting the alert after the first finished, the same
	// verdict reported again by another widget, and a dispatch arriving late.
	for _, status := range []string{"playing", "completed", "dispatched"} {
		if got := moveAlert(t, svc, "env-1", status); got.Status != "completed" {
			t.Fatalf("refused %s returned status %s, want the row as it is", status, got.Status)
		}
	}

	assertPublished(t, db, []publishedStep{{"sent", 1}, {"playing", 2}, {"completed", 3}})
	after := storedAlert(t, db, created.Id)
	if after.Version != before.Version || !after.UpdatedAt.Equal(before.UpdatedAt) {
		t.Fatalf("refused writes changed the row: v%d %v, was v%d %v",
			after.Version, after.UpdatedAt, before.Version, before.UpdatedAt)
	}
}

func TestAlertLifecycleLetsALateVerdictReplaceAnEarlierOne(t *testing.T) {
	svc, db := newAlertSvc(t)
	created := createAlert(t, svc, "env-1")
	if _, err := svc.UpdateAlertLifecycle(context.Background(), &client.UpdateAlertLifecycleRequest{
		EnvelopeId: "env-1",
		Status:     "timed_out",
		Error:      "no ack",
	}); err != nil {
		t.Fatalf("timed_out: %v", err)
	}
	timedOut := storedAlert(t, db, created.Id)

	moveAlert(t, svc, "env-1", "completed")

	assertPublished(t, db, []publishedStep{{"sent", 1}, {"timed_out", 2}, {"completed", 3}})
	completed := storedAlert(t, db, created.Id)
	if completed.CompletedAt == nil || !completed.CompletedAt.Equal(*timedOut.CompletedAt) {
		t.Fatalf("completed_at = %v, want the first verdict's %v", completed.CompletedAt, timedOut.CompletedAt)
	}
}

func TestAlertReplayedRowRefusesLaterLifecycleWrites(t *testing.T) {
	svc, db := newAlertSvc(t)
	created := createAlert(t, svc, "env-1")
	if _, err := svc.UpdateAlertStatus(context.Background(), &client.UpdateAlertStatusRequest{
		Id:     created.Id,
		Status: "replayed",
	}); err != nil {
		t.Fatalf("UpdateAlertStatus: %v", err)
	}

	moveAlert(t, svc, "env-1", "completed")

	assertPublished(t, db, []publishedStep{{"sent", 1}, {"replayed", 2}})
}

func TestAlertLifecycleForAnUnknownEnvelopeIsNotFound(t *testing.T) {
	svc, _ := newAlertSvc(t)
	_, err := svc.UpdateAlertLifecycle(context.Background(), &client.UpdateAlertLifecycleRequest{
		EnvelopeId: "missing",
		Status:     "playing",
	})
	twerr, ok := err.(twirp.Error)
	if !ok || twerr.Code() != twirp.NotFound {
		t.Fatalf("err = %v, want not_found", err)
	}
}

var nineDigitUTC = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{9}Z$`)

var alertTimestampFields = []string{"created_at", "updated_at", "dispatched_at", "played_at", "completed_at"}

func TestPublishedAlertSnapshotsCarryTheStoredRow(t *testing.T) {
	svc, db := newAlertSvc(t)
	created := createAlert(t, svc, "env-1")
	moveAlert(t, svc, "env-1", "playing")

	snapshots := publishedAlerts(t, db)
	if len(snapshots) != 2 {
		t.Fatalf("published %d snapshots, want 2", len(snapshots))
	}
	stored := buildAlertChangeData(storedAlert(t, db, created.Id))
	for _, field := range alertTimestampFields {
		if snapshots[1][field] != stored[field] {
			t.Fatalf("%s = %v, stored row formats as %v", field, snapshots[1][field], stored[field])
		}
	}
	for _, field := range []string{"created_at", "dispatched_at"} {
		if snapshots[0][field] != stored[field] {
			t.Fatalf("created snapshot %s = %v, stored row formats as %v", field, snapshots[0][field], stored[field])
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
