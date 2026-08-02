package services

import (
	"context"
	"testing"
	"time"

	"github.com/dgraph-io/badger/v3"
	client "github.com/wolfymaster/woofx3/clients/db"
)

func newStorageTestService(t *testing.T) *storageService {
	t.Helper()
	db, err := badger.Open(badger.DefaultOptions("").WithInMemory(true).WithLoggingLevel(badger.ERROR))
	if err != nil {
		t.Fatalf("open in-memory badger: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return NewStorageService(db)
}

func TestStorageService_GetSet_RoundTrip(t *testing.T) {
	svc := newStorageTestService(t)
	ctx := context.Background()

	if _, err := svc.Set(ctx, &client.SetRequest{
		Item: &client.StorageItem{Key: "counter:count", Value: "1", ApplicationId: "app-1"},
	}); err != nil {
		t.Fatalf("Set: %v", err)
	}

	resp, err := svc.Get(ctx, &client.GetRequest{Key: "counter:count", ApplicationId: "app-1"})
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if resp.Item == nil {
		t.Fatalf("expected item, got nil — this is exactly the bug reported: values don't persist across calls")
	}
	if resp.Item.Value != "1" {
		t.Fatalf("expected value %q, got %q", "1", resp.Item.Value)
	}
	if resp.Item.CreatedAt == 0 {
		t.Fatalf("expected created_at to be set")
	}

	// Second write must be visible to a subsequent read (the increment.js pattern).
	if _, err := svc.Set(ctx, &client.SetRequest{
		Item: &client.StorageItem{Key: "counter:count", Value: "2", ApplicationId: "app-1"},
	}); err != nil {
		t.Fatalf("Set #2: %v", err)
	}
	resp, err = svc.Get(ctx, &client.GetRequest{Key: "counter:count", ApplicationId: "app-1"})
	if err != nil {
		t.Fatalf("Get #2: %v", err)
	}
	if resp.Item == nil || resp.Item.Value != "2" {
		t.Fatalf("expected updated value %q, got %+v", "2", resp.Item)
	}
}

func TestStorageService_Get_MissingKeyReturnsNilItem(t *testing.T) {
	svc := newStorageTestService(t)
	resp, err := svc.Get(context.Background(), &client.GetRequest{Key: "nope", ApplicationId: "app-1"})
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if resp.Item != nil {
		t.Fatalf("expected nil item for missing key, got %+v", resp.Item)
	}
}

func TestStorageService_ScopedPerApplication(t *testing.T) {
	svc := newStorageTestService(t)
	ctx := context.Background()

	if _, err := svc.Set(ctx, &client.SetRequest{
		Item: &client.StorageItem{Key: "shared-key", Value: "app-1-value", ApplicationId: "app-1"},
	}); err != nil {
		t.Fatalf("Set: %v", err)
	}

	resp, err := svc.Get(ctx, &client.GetRequest{Key: "shared-key", ApplicationId: "app-2"})
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if resp.Item != nil {
		t.Fatalf("expected app-2 to not see app-1's value, got %+v", resp.Item)
	}
}

func TestStorageService_ExpiredItemNotReturned(t *testing.T) {
	svc := newStorageTestService(t)
	ctx := context.Background()
	past := time.Now().Add(-time.Hour).Unix()

	if _, err := svc.Set(ctx, &client.SetRequest{
		Item: &client.StorageItem{Key: "expiring", Value: "x", ApplicationId: "app-1", ExpiresAt: past},
	}); err != nil {
		t.Fatalf("Set: %v", err)
	}

	resp, err := svc.Get(ctx, &client.GetRequest{Key: "expiring", ApplicationId: "app-1"})
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if resp.Item != nil {
		t.Fatalf("expected expired item to read back as missing, got %+v", resp.Item)
	}
}

func TestStorageService_ExpiresAtZeroNeverExpires(t *testing.T) {
	svc := newStorageTestService(t)
	ctx := context.Background()

	if _, err := svc.Set(ctx, &client.SetRequest{
		Item: &client.StorageItem{Key: "persistent", Value: "x", ApplicationId: "app-1", ExpiresAt: 0},
	}); err != nil {
		t.Fatalf("Set: %v", err)
	}

	resp, err := svc.Get(ctx, &client.GetRequest{Key: "persistent", ApplicationId: "app-1"})
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if resp.Item == nil {
		t.Fatalf("expected expires_at=0 to mean never-expiring, got nil item")
	}
}

func TestStorageService_Delete(t *testing.T) {
	svc := newStorageTestService(t)
	ctx := context.Background()

	if _, err := svc.Set(ctx, &client.SetRequest{
		Item: &client.StorageItem{Key: "to-delete", Value: "x", ApplicationId: "app-1"},
	}); err != nil {
		t.Fatalf("Set: %v", err)
	}
	if _, err := svc.Delete(ctx, &client.DeleteRequest{Key: "to-delete", ApplicationId: "app-1"}); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	resp, err := svc.Get(ctx, &client.GetRequest{Key: "to-delete", ApplicationId: "app-1"})
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if resp.Item != nil {
		t.Fatalf("expected deleted item to be gone, got %+v", resp.Item)
	}
}

func TestStorageService_ClearNamespace(t *testing.T) {
	svc := newStorageTestService(t)
	ctx := context.Background()

	if _, err := svc.Set(ctx, &client.SetRequest{
		Item: &client.StorageItem{Key: "a", Value: "1", ApplicationId: "app-1", Namespace: "ns-a"},
	}); err != nil {
		t.Fatalf("Set a: %v", err)
	}
	if _, err := svc.Set(ctx, &client.SetRequest{
		Item: &client.StorageItem{Key: "b", Value: "2", ApplicationId: "app-1", Namespace: "ns-b"},
	}); err != nil {
		t.Fatalf("Set b: %v", err)
	}

	if _, err := svc.ClearNamespace(ctx, &client.ClearNamespaceRequest{Namespace: "ns-a", ApplicationId: "app-1"}); err != nil {
		t.Fatalf("ClearNamespace: %v", err)
	}

	respA, _ := svc.Get(ctx, &client.GetRequest{Key: "a", ApplicationId: "app-1"})
	if respA.Item != nil {
		t.Fatalf("expected ns-a item cleared, got %+v", respA.Item)
	}
	respB, _ := svc.Get(ctx, &client.GetRequest{Key: "b", ApplicationId: "app-1"})
	if respB.Item == nil {
		t.Fatalf("expected ns-b item to survive clearing a different namespace")
	}
}

func TestStorageService_ClearAllForApplication(t *testing.T) {
	svc := newStorageTestService(t)
	ctx := context.Background()

	if _, err := svc.Set(ctx, &client.SetRequest{
		Item: &client.StorageItem{Key: "k", Value: "1", ApplicationId: "app-1"},
	}); err != nil {
		t.Fatalf("Set app-1: %v", err)
	}
	if _, err := svc.Set(ctx, &client.SetRequest{
		Item: &client.StorageItem{Key: "k", Value: "1", ApplicationId: "app-2"},
	}); err != nil {
		t.Fatalf("Set app-2: %v", err)
	}

	if _, err := svc.ClearAllForApplication(ctx, &client.ClearAllForApplicationRequest{ApplicationId: "app-1"}); err != nil {
		t.Fatalf("ClearAllForApplication: %v", err)
	}

	resp1, _ := svc.Get(ctx, &client.GetRequest{Key: "k", ApplicationId: "app-1"})
	if resp1.Item != nil {
		t.Fatalf("expected app-1 cleared, got %+v", resp1.Item)
	}
	resp2, _ := svc.Get(ctx, &client.GetRequest{Key: "k", ApplicationId: "app-2"})
	if resp2.Item == nil {
		t.Fatalf("expected app-2 to be untouched by clearing app-1")
	}
}

func TestStorageService_Get_RequiresKeyAndApplicationId(t *testing.T) {
	svc := newStorageTestService(t)
	ctx := context.Background()

	if _, err := svc.Get(ctx, &client.GetRequest{Key: "", ApplicationId: "app-1"}); err == nil {
		t.Fatalf("expected error for missing key")
	}
	if _, err := svc.Get(ctx, &client.GetRequest{Key: "k", ApplicationId: ""}); err == nil {
		t.Fatalf("expected error for missing application_id")
	}
}
