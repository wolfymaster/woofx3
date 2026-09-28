package services

import (
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/dgraph-io/badger/v3"
)

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestModuleStorageService_ConnectImportsAndServes(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	badgerDir := filepath.Join(dir, "badger")
	writeBadgerStore(t, badgerDir, func(db *badger.DB) {
		putBadgerItem(t, db, "woofx3", "count", badgerItem{Value: "3", CreatedAt: 1})
	})

	cfg := ModuleStorageConfig{Path: filepath.Join(dir, "module-storage.db"), BadgerPath: badgerDir}
	svc := NewModuleStorageService(cfg, discardLogger())
	if err := svc.Connect(ctx, nil); err != nil {
		t.Fatalf("Connect: %v", err)
	}
	if !svc.Connected() || svc.Client() == nil {
		t.Fatal("connected service has no pool")
	}
	if got := mustGet(t, NewStorageService(svc.Client()), "woofx3", "count"); got.GetValue() != "3" {
		t.Errorf("imported woofx3/count = %+v, want 3", got)
	}
	mustSet(t, NewStorageService(svc.Client()), storageItem("woofx3", "count", "4"))

	if err := svc.Disconnect(ctx); err != nil {
		t.Fatalf("Disconnect: %v", err)
	}
	if svc.Connected() || svc.Client() != nil {
		t.Error("disconnected service still hands out a pool")
	}

	// Reconnecting, as the runtime does after a health check failure, reopens
	// the same file.
	if err := svc.Connect(ctx, nil); err != nil {
		t.Fatalf("reconnect: %v", err)
	}
	defer svc.Disconnect(ctx)
	if got := mustGet(t, NewStorageService(svc.Client()), "woofx3", "count"); got.GetValue() != "4" {
		t.Errorf("woofx3/count after reconnect = %+v, want 4", got)
	}
}

func TestModuleStorageService_FailedRestoreStaysDisconnected(t *testing.T) {
	dir := t.TempDir()
	unreadable := filepath.Join(dir, "replica")
	if err := os.WriteFile(unreadable, []byte("not a replica"), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}

	svc := NewModuleStorageService(ModuleStorageConfig{
		Path:       filepath.Join(dir, "data", "module-storage.db"),
		ReplicaURL: "file://" + filepath.ToSlash(unreadable),
	}, discardLogger())
	if err := svc.Connect(context.Background(), nil); err == nil {
		t.Fatal("Connect succeeded over an unreadable replica")
	}
	if svc.Connected() || svc.Client() != nil {
		t.Error("a failed restore left the service connected")
	}
}

func TestModuleStorageService_RefusesNewerSchema(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "module-storage.db")
	svc := NewModuleStorageService(ModuleStorageConfig{Path: path}, discardLogger())
	if err := svc.Connect(ctx, nil); err != nil {
		t.Fatalf("Connect: %v", err)
	}
	if _, err := svc.Client().Exec(`PRAGMA user_version = 99`); err != nil {
		t.Fatalf("set user_version: %v", err)
	}
	if err := svc.Disconnect(ctx); err != nil {
		t.Fatalf("Disconnect: %v", err)
	}

	if err := svc.Connect(ctx, nil); err == nil {
		_ = svc.Disconnect(ctx)
		t.Fatal("Connect accepted a storage file from a newer schema")
	}
}

// The runtime disconnects services with a context it has already cancelled;
// the final flush to the replica must happen anyway.
func TestModuleStorageService_DisconnectFlushesOnCancelledContext(t *testing.T) {
	dir := t.TempDir()
	replica := "file://" + filepath.ToSlash(filepath.Join(dir, "replica"))

	first := NewModuleStorageService(ModuleStorageConfig{Path: filepath.Join(dir, "host-a", "module-storage.db"), ReplicaURL: replica}, discardLogger())
	if err := first.Connect(context.Background(), nil); err != nil {
		t.Fatalf("Connect: %v", err)
	}
	mustSet(t, NewStorageService(first.Client()), storageItem("woofx3", "count", "42"))

	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	if err := first.Disconnect(cancelled); err != nil {
		t.Fatalf("Disconnect: %v", err)
	}

	restored := NewModuleStorageService(ModuleStorageConfig{Path: filepath.Join(dir, "host-b", "module-storage.db"), ReplicaURL: replica}, discardLogger())
	if err := restored.Connect(context.Background(), nil); err != nil {
		t.Fatalf("Connect restored: %v", err)
	}
	defer restored.Disconnect(context.Background())
	if got := mustGet(t, NewStorageService(restored.Client()), "woofx3", "count"); got.GetValue() != "42" {
		t.Errorf("restored woofx3/count = %+v, want 42", got)
	}
}
