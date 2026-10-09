package services

import (
	"context"
	"log/slog"
	"strings"
	"testing"

	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/google/uuid"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/app/workers"
	"github.com/wolfymaster/woofx3/db/database/models"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
	"gorm.io/gorm"
)

// newInstanceSvc runs the real SQLite migration chain and installs one module
// whose display name differs from its manifest id, the way every published
// module's does.
func newInstanceSvc(t *testing.T) (*moduleService, *gorm.DB) {
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
	module := &models.Module{
		ID:        uuid.New(),
		ModuleKey: "woofx3_wheel_spin:1.0.0:abc",
		ModuleID:  "woofx3_wheel_spin",
		Name:      "Wheel Spin",
		Version:   "1.0.0",
	}
	if err := db.Create(module).Error; err != nil {
		t.Fatalf("install module: %v", err)
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
	publisher := workers.NewEventPublisher(repo.NewDbEventRepository(db), slog.New(slog.DiscardHandler))
	svc := NewModuleService(
		repo.NewModuleRepository(db),
		repo.NewResourceReferenceRepository(db),
		repo.NewModuleResourceInstanceRepository(db),
		publisher,
	)
	return svc, db
}

func createWheel(t *testing.T, svc *moduleService, settingsJSON string) *client.ModuleResourceInstance {
	t.Helper()
	resp, err := svc.CreateResourceInstance(context.Background(), &client.CreateResourceInstanceRequest{
		ModuleName:   "woofx3_wheel_spin",
		Kind:         "wheel",
		InstanceId:   "prizes",
		DisplayName:  "Prizes",
		SettingsJson: settingsJSON,
	})
	if err != nil {
		t.Fatalf("CreateResourceInstance: %v", err)
	}
	return resp.Instance
}

func TestAnInstanceIsAddressedByItsModulesManifestIdNotItsName(t *testing.T) {
	svc, db := newInstanceSvc(t)

	created := createWheel(t, svc, "")
	if created.CanonicalId != "woofx3_wheel_spin:wheel:prizes" {
		t.Fatalf("canonical id = %q, want woofx3_wheel_spin:wheel:prizes", created.CanonicalId)
	}
	if created.ModuleName != "woofx3_wheel_spin" {
		t.Fatalf("module name = %q, want woofx3_wheel_spin", created.ModuleName)
	}

	got, err := svc.GetResourceInstance(context.Background(), &client.GetResourceInstanceRequest{
		CanonicalId: "woofx3_wheel_spin:wheel:prizes",
	})
	if err != nil {
		t.Fatalf("GetResourceInstance by the manifest id: %v", err)
	}
	if got.Instance.CanonicalId != created.CanonicalId {
		t.Fatalf("got %q, want %q", got.Instance.CanonicalId, created.CanonicalId)
	}

	var event models.WorkerEvent
	if err := db.Where("entity_type = ? AND operation = ?", "module.resource.instance", "created").First(&event).Error; err != nil {
		t.Fatalf("created event: %v", err)
	}
	if want := `"canonical_id":"woofx3_wheel_spin:wheel:prizes"`; !strings.Contains(event.Payload, want) {
		t.Fatalf("event payload %s does not carry %s", event.Payload, want)
	}
}
