package workers

import (
	"encoding/json"
	"io"
	"log/slog"
	"testing"

	cloudevents "github.com/cloudevents/sdk-go/v2"
	"github.com/go-gormigrate/gormigrate/v2"
	gsqlite "github.com/libtnb/sqlite"
	"github.com/wolfymaster/woofx3/db/database"
	"github.com/wolfymaster/woofx3/db/database/migrate/migrations"
	"github.com/wolfymaster/woofx3/db/database/models"
	"github.com/wolfymaster/woofx3/db/database/repository"
	"gorm.io/gorm"
)

func TestPublishEventInCarriesItsSubjectAsTypeAndItsExtensionsOntoTheWire(t *testing.T) {
	db, err := gorm.Open(gsqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("sql db: %v", err)
	}
	// Every connection to :memory: is a separate database.
	sqlDB.SetMaxOpenConns(1)
	chain, err := migrations.For(database.DialectSQLite)
	if err != nil {
		t.Fatalf("migrations.For: %v", err)
	}
	if err := gormigrate.New(db, migrations.Options, chain).Migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	publisher := NewEventPublisher(repository.NewDbEventRepository(db), slog.New(slog.NewTextHandler(io.Discard, nil)))

	if err := publisher.PublishEventIn(db, "viewer.segment.entered", "user:segment:chatty",
		map[string]string{"bad_name": "x"}, nil); err == nil {
		t.Fatal("an extension name the SDK would drop was accepted")
	}
	if err := publisher.PublishEventIn(db, "viewer", "user:segment:chatty", nil, nil); err == nil {
		t.Fatal("a subject with no operation was accepted")
	}
	err = db.Transaction(func(tx *gorm.DB) error {
		return publisher.PublishEventIn(tx, "viewer.segment.entered", "user:segment:chatty",
			map[string]string{"platform": "twitch", "sessionid": "s1"}, map[string]string{"viewerId": "v1"})
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

func TestPublishInWritesOutboxRowsOnTheSQLiteSchema(t *testing.T) {
	db, err := gorm.Open(gsqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("sql db: %v", err)
	}
	// Every connection to :memory: is a separate database.
	sqlDB.SetMaxOpenConns(1)
	chain, err := migrations.For(database.DialectSQLite)
	if err != nil {
		t.Fatalf("migrations.For: %v", err)
	}
	if err := gormigrate.New(db, migrations.Options, chain).Migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	publisher := NewEventPublisher(repository.NewDbEventRepository(db), slog.New(slog.NewTextHandler(io.Discard, nil)))

	for _, id := range []string{"a", "b"} {
		if err := publisher.PublishIn(db, PublishOptions{EntityType: "thing", EntityID: id, Operation: "created"}); err != nil {
			t.Fatalf("PublishIn(%s): %v", id, err)
		}
	}

	var ids []string
	if err := db.Model(&models.WorkerEvent{}).Order("entity_id").Pluck("id", &ids).Error; err != nil {
		t.Fatalf("read outbox: %v", err)
	}
	if len(ids) != 2 || ids[0] == "" || ids[0] == ids[1] {
		t.Errorf("outbox ids = %q, want two distinct ids", ids)
	}
}
