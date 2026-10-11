package services

import (
	"context"
	"testing"

	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"gorm.io/gorm"
)

const composedSnapshot = `{"layout":{"width":800,"height":200},"widgets":{},"behaviors":{}}`

func recordComposition(svc client.AlertService, row *client.Alert, snapshot string) (*client.AlertResponse, error) {
	return svc.RecordAlertComposition(context.Background(), &client.RecordAlertCompositionRequest{
		Id:                 row.Id,
		EnvelopeId:         row.EnvelopeId,
		CompositionId:      "0b7f6a52-5d0c-4a8e-9a57-2f1c3f0e8d11",
		CompositionVersion: "v1",
		SnapshotJson:       snapshot,
	})
}

// A play's composition is recorded once, publishes like any write, and is
// served with the row.
func TestRecordAlertCompositionIsWrittenOnceAndServed(t *testing.T) {
	forEachAlertDialect(t, func(t *testing.T, svc client.AlertService, db *gorm.DB) {
		created := createAlert(t, svc, "env-1")
		resp, err := recordComposition(svc, created, composedSnapshot)
		if err != nil {
			t.Fatalf("record: %v", err)
		}
		got := resp.Alert
		if got.CompositionId != "0b7f6a52-5d0c-4a8e-9a57-2f1c3f0e8d11" || got.CompositionVersion != "v1" ||
			!sameJSON(t, got.SnapshotJson, composedSnapshot) || got.Version != 2 || got.Status != "sent" {
			t.Fatalf("recorded row = %+v", got)
		}

		before := storedAlert(t, db, created.Id)
		resp, err = recordComposition(svc, created, `{"layout":{},"widgets":{},"behaviors":{}}`)
		if err != nil {
			t.Fatalf("second record: %v", err)
		}
		if !sameJSON(t, resp.Alert.SnapshotJson, composedSnapshot) {
			t.Fatalf("a second record replaced the snapshot: %s", resp.Alert.SnapshotJson)
		}
		assertUnchanged(t, before, storedAlert(t, db, created.Id))
		assertPublished(t, db, []publishedStep{{"sent", 1}, {"sent", 2}})

		read, err := svc.GetAlert(context.Background(), &client.GetAlertRequest{Id: created.Id})
		if err != nil || !sameJSON(t, read.Alert.SnapshotJson, composedSnapshot) {
			t.Fatalf("get after record: %+v, %v", read, err)
		}
	})
}

func TestRecordAlertCompositionRefusesAnIncompleteOrMisaddressedRecord(t *testing.T) {
	forEachAlertDialect(t, func(t *testing.T, svc client.AlertService, db *gorm.DB) {
		created := createAlert(t, svc, "env-1")
		if _, err := recordComposition(svc, created, ""); twirpCode(err) != twirp.InvalidArgument {
			t.Fatalf("a record with no snapshot: %v, want invalid_argument", err)
		}
		other := &client.Alert{Id: created.Id, EnvelopeId: "env-2"}
		if _, err := recordComposition(svc, other, composedSnapshot); twirpCode(err) != twirp.NotFound {
			t.Fatalf("a record against another envelope: %v, want not_found", err)
		}
	})
}

// A replay of a composition alert carries what the original played onto its
// own row; the three fields come together or not at all.
func TestCreateAlertCarriesAReplayedSnapshot(t *testing.T) {
	forEachAlertDialect(t, func(t *testing.T, svc client.AlertService, db *gorm.DB) {
		resp, err := svc.CreateAlert(context.Background(), &client.CreateAlertRequest{
			Payload:            `{"id":"env-1"}`,
			EnvelopeId:         "env-1",
			CompositionId:      "0b7f6a52-5d0c-4a8e-9a57-2f1c3f0e8d11",
			CompositionVersion: "v1",
			SnapshotJson:       composedSnapshot,
		})
		if err != nil {
			t.Fatalf("create: %v", err)
		}
		if resp.Alert.CompositionVersion != "v1" || !sameJSON(t, resp.Alert.SnapshotJson, composedSnapshot) {
			t.Fatalf("created row = %+v", resp.Alert)
		}
		_, err = svc.CreateAlert(context.Background(), &client.CreateAlertRequest{
			Payload:       `{"id":"env-2"}`,
			EnvelopeId:    "env-2",
			CompositionId: "0b7f6a52-5d0c-4a8e-9a57-2f1c3f0e8d11",
		})
		if twirpCode(err) != twirp.InvalidArgument {
			t.Fatalf("a composition id with no snapshot: %v, want invalid_argument", err)
		}
		plain := createAlert(t, svc, "env-3")
		if plain.SnapshotJson != "" || plain.CompositionId != "" {
			t.Fatalf("an inline alert has a snapshot: %+v", plain)
		}
	})
}
