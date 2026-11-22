package workers

import (
	"encoding/json"
	"io"
	"log/slog"
	"testing"

	cloudevents "github.com/cloudevents/sdk-go/v2"
	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/wolfymaster/woofx3/common/messages"
	"github.com/wolfymaster/woofx3/db/database"
	"github.com/wolfymaster/woofx3/db/database/migrate/migrations"
	"github.com/wolfymaster/woofx3/db/database/models"
	"github.com/wolfymaster/woofx3/db/database/repository"
	"gorm.io/gorm"
)

// openOutboxDB opens an in-memory SQLite database the way db-proxy does and
// migrates it with the real SQLite chain.
func openOutboxDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := database.InitializeDB("sqlite:///:memory:", slog.New(slog.NewTextHandler(io.Discard, nil)), database.RandomIDs{})
	if err != nil {
		t.Fatalf("InitializeDB: %v", err)
	}
	chain, err := migrations.For(database.DialectSQLite)
	if err != nil {
		t.Fatalf("migrations.For: %v", err)
	}
	if err := gormigrate.New(db, migrations.Options, chain).Migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return db
}

// The outbox row has no id until the client gives it one: the SQLite schema
// has no column default for it.
func TestPublishStoresTheEventOnSQLite(t *testing.T) {
	db := openOutboxDB(t)
	publisher := NewEventPublisher(repository.NewDbEventRepository(db), slog.New(slog.NewTextHandler(io.Discard, nil)))

	for _, entityID := range []string{"c1", "c2"} {
		err := publisher.Publish(PublishOptions{
			EntityType:      "command",
			EntityID:        entityID,
			Operation:       "created",
			Data:            map[string]string{"id": entityID},
			AutoAcknowledge: true,
		})
		if err != nil {
			t.Fatalf("Publish %s: %v", entityID, err)
		}
	}

	var events []models.WorkerEvent
	if err := db.Order("entity_id").Find(&events).Error; err != nil {
		t.Fatalf("read outbox: %v", err)
	}
	if len(events) != 2 {
		t.Fatalf("outbox holds %d events, want 2", len(events))
	}
	if events[0].ID == "" || events[1].ID == "" || events[0].ID == events[1].ID {
		t.Fatalf("event ids = %q, %q, want two distinct ids", events[0].ID, events[1].ID)
	}
}

func validEdge() *messages.ViewerSegmentEdge {
	return &messages.ViewerSegmentEdge{
		SegmentId:  "user:segment:chatty",
		Platform:   "twitch",
		ViewerId:   "v1",
		ViewerName: "Wolfy",
		SessionId:  "s1",
		Facts: messages.ViewerSegmentEdgeFacts{"user": {"messages": messages.FactChange{
			Before: messages.NewFloat64FactReading(1),
			After:  messages.NewNullFactReading(struct{}{}),
		}}},
		Cause: messages.EdgeCause{Source: "twitch", EventId: "e1"},
	}
}

// The envelope the worker builds from a row is the one the contract names, so
// the data validated at publish and the attributes added here are one message.
func TestEncodeCloudEventIsTheContractsEnvelope(t *testing.T) {
	db := openOutboxDB(t)
	publisher := NewEventPublisher(repository.NewDbEventRepository(db), slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err := publisher.PublishEventIn(db, "viewer.segment.entered", "user:segment:chatty",
		map[string]string{"platform": "twitch", "sessionid": "s1"}, validEdge()); err != nil {
		t.Fatalf("PublishEventIn: %v", err)
	}
	var event models.WorkerEvent
	if err := db.First(&event).Error; err != nil {
		t.Fatalf("read event: %v", err)
	}

	wire, err := encodeCloudEvent(&event)
	if err != nil {
		t.Fatalf("encodeCloudEvent: %v", err)
	}
	var envelope messages.ViewerSegmentEnteredEvent
	if err := envelope.UnmarshalJSON(wire); err != nil {
		t.Fatalf("the envelope does not decode as the contract's: %v\n%s", err, wire)
	}
	if err := envelope.Validate(); err != nil {
		t.Fatalf("the envelope breaks the contract: %v\n%s", err, wire)
	}
}

func TestPublishEventInCarriesItsSubjectAsTypeAndItsExtensionsOntoTheWire(t *testing.T) {
	db := openOutboxDB(t)
	publisher := NewEventPublisher(repository.NewDbEventRepository(db), slog.New(slog.NewTextHandler(io.Discard, nil)))

	if err := publisher.PublishEventIn(db, "viewer.segment.entered", "user:segment:chatty",
		map[string]string{"bad_name": "x"}, validEdge()); err == nil {
		t.Fatal("an extension name the SDK would drop was accepted")
	}
	if err := publisher.PublishEventIn(db, "viewer", "user:segment:chatty", nil, validEdge()); err == nil {
		t.Fatal("a subject with no operation was accepted")
	}
	broken := validEdge()
	broken.ViewerId = ""
	if err := publisher.PublishEventIn(db, "viewer.segment.entered", "user:segment:chatty", nil, broken); err == nil {
		t.Fatal("data that breaks its contract was written to the outbox")
	}
	if err := publisher.PublishEventIn(db, "viewer.segment.entered", "user:segment:chatty", nil, nil); err == nil {
		t.Fatal("an event with no data was written to the outbox")
	}
	err := db.Transaction(func(tx *gorm.DB) error {
		return publisher.PublishEventIn(tx, "viewer.segment.entered", "user:segment:chatty",
			map[string]string{"platform": "twitch", "sessionid": "s1"}, validEdge())
	})
	if err != nil {
		t.Fatalf("PublishEventIn: %v", err)
	}

	var event models.WorkerEvent
	if err := db.First(&event).Error; err != nil {
		t.Fatalf("read event: %v", err)
	}
	if event.NATSSubject != "viewer.segment.entered" || event.EventType != "viewer.segment.entered" ||
		event.EntityType != "viewer.segment" || event.Operation != "entered" || !event.AutoAcknowledge {
		t.Fatalf("stored event = %+v", event)
	}
	ce := cloudevents.NewEvent()
	if err := setEventExtensions(&ce, &event); err != nil {
		t.Fatalf("setEventExtensions: %v", err)
	}
	wire, err := json.Marshal(ce)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(wire, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded["platform"] != "twitch" || decoded["sessionid"] != "s1" {
		t.Fatalf("wire event = %s, want platform and sessionid extensions", wire)
	}

	plain := models.WorkerEvent{ID: "e2"}
	ce = cloudevents.NewEvent()
	if err := setEventExtensions(&ce, &plain); err != nil || len(ce.Extensions()) != 0 {
		t.Fatalf("an event without extensions got %v, %v", ce.Extensions(), err)
	}
}
