package services

import (
	"context"
	"fmt"
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
		Item: &client.StorageItem{Key: "counter:count", Value: "1", Namespace: "mod"},
	}); err != nil {
		t.Fatalf("Set: %v", err)
	}

	resp, err := svc.Get(ctx, &client.GetRequest{Key: "counter:count", Namespace: "mod"})
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
		Item: &client.StorageItem{Key: "counter:count", Value: "2", Namespace: "mod"},
	}); err != nil {
		t.Fatalf("Set #2: %v", err)
	}
	resp, err = svc.Get(ctx, &client.GetRequest{Key: "counter:count", Namespace: "mod"})
	if err != nil {
		t.Fatalf("Get #2: %v", err)
	}
	if resp.Item == nil || resp.Item.Value != "2" {
		t.Fatalf("expected updated value %q, got %+v", "2", resp.Item)
	}
}

func TestStorageService_Get_MissingKeyReturnsNilItem(t *testing.T) {
	svc := newStorageTestService(t)
	resp, err := svc.Get(context.Background(), &client.GetRequest{Key: "nope", Namespace: "mod"})
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if resp.Item != nil {
		t.Fatalf("expected nil item for missing key, got %+v", resp.Item)
	}
}

func TestStorageService_ExpiredItemNotReturned(t *testing.T) {
	svc := newStorageTestService(t)
	ctx := context.Background()
	past := time.Now().Add(-time.Hour).Unix()

	if _, err := svc.Set(ctx, &client.SetRequest{
		Item: &client.StorageItem{Key: "expiring", Value: "x", ExpiresAt: past, Namespace: "mod"},
	}); err != nil {
		t.Fatalf("Set: %v", err)
	}

	resp, err := svc.Get(ctx, &client.GetRequest{Key: "expiring", Namespace: "mod"})
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
		Item: &client.StorageItem{Key: "persistent", Value: "x", ExpiresAt: 0, Namespace: "mod"},
	}); err != nil {
		t.Fatalf("Set: %v", err)
	}

	resp, err := svc.Get(ctx, &client.GetRequest{Key: "persistent", Namespace: "mod"})
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
		Item: &client.StorageItem{Key: "to-delete", Value: "x", Namespace: "mod"},
	}); err != nil {
		t.Fatalf("Set: %v", err)
	}
	if _, err := svc.Delete(ctx, &client.DeleteRequest{Key: "to-delete", Namespace: "mod"}); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	resp, err := svc.Get(ctx, &client.GetRequest{Key: "to-delete", Namespace: "mod"})
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
		Item: &client.StorageItem{Key: "a", Value: "1", Namespace: "ns-a"},
	}); err != nil {
		t.Fatalf("Set a: %v", err)
	}
	if _, err := svc.Set(ctx, &client.SetRequest{
		Item: &client.StorageItem{Key: "b", Value: "2", Namespace: "ns-b"},
	}); err != nil {
		t.Fatalf("Set b: %v", err)
	}

	if _, err := svc.ClearNamespace(ctx, &client.ClearNamespaceRequest{Namespace: "ns-a"}); err != nil {
		t.Fatalf("ClearNamespace: %v", err)
	}

	respA, _ := svc.Get(ctx, &client.GetRequest{Key: "a", Namespace: "ns-a"})
	if respA.Item != nil {
		t.Fatalf("expected ns-a item cleared, got %+v", respA.Item)
	}
	respB, _ := svc.Get(ctx, &client.GetRequest{Key: "b", Namespace: "ns-b"})
	if respB.Item == nil {
		t.Fatalf("expected ns-b item to survive clearing a different namespace")
	}
}

func TestStorageService_ClearSessionScoped(t *testing.T) {
	svc := newStorageTestService(t)
	ctx := context.Background()

	if _, err := svc.Set(ctx, &client.SetRequest{
		Item: &client.StorageItem{Key: "ephemeral", Value: "1", ClearOnSessionEnd: true, Namespace: "mod"},
	}); err != nil {
		t.Fatalf("Set ephemeral: %v", err)
	}
	if _, err := svc.Set(ctx, &client.SetRequest{
		Item: &client.StorageItem{Key: "durable", Value: "2", Namespace: "mod"},
	}); err != nil {
		t.Fatalf("Set durable: %v", err)
	}

	resp, err := svc.ClearSessionScoped(ctx, &client.ClearSessionScopedRequest{})
	if err != nil {
		t.Fatalf("ClearSessionScoped: %v", err)
	}
	if resp.Cleared != 1 {
		t.Errorf("Cleared = %d, want 1", resp.Cleared)
	}

	ephemeral, _ := svc.Get(ctx, &client.GetRequest{Key: "ephemeral", Namespace: "mod"})
	if ephemeral.Item != nil {
		t.Errorf("expected session-scoped item cleared, got %+v", ephemeral.Item)
	}
	// The whole point of the flag: everything not marked survives the boundary.
	durable, _ := svc.Get(ctx, &client.GetRequest{Key: "durable", Namespace: "mod"})
	if durable.Item == nil {
		t.Error("expected unflagged item to survive a session boundary")
	}
}

func TestStorageService_Get_RequiresKey(t *testing.T) {
	svc := newStorageTestService(t)

	if _, err := svc.Get(context.Background(), &client.GetRequest{Key: "", Namespace: "mod"}); err == nil {
		t.Fatalf("expected error for missing key")
	}
}

// The namespace is the owning module: the same key written by two modules is
// two values, and neither can read the other's.
func TestStorageService_ScopedPerModule(t *testing.T) {
	svc := newStorageTestService(t)
	ctx := context.Background()

	for module, value := range map[string]string{"woofx3": "1", "other_module": "2"} {
		if _, err := svc.Set(ctx, &client.SetRequest{
			Item: &client.StorageItem{Key: "state", Value: value, Namespace: module},
		}); err != nil {
			t.Fatalf("Set %s: %v", module, err)
		}
	}

	for module, want := range map[string]string{"woofx3": "1", "other_module": "2"} {
		resp, err := svc.Get(ctx, &client.GetRequest{Key: "state", Namespace: module})
		if err != nil {
			t.Fatalf("Get %s: %v", module, err)
		}
		if resp.Item == nil || resp.Item.Value != want {
			t.Errorf("%s reads %+v, want %q", module, resp.Item, want)
		}
	}
}

func TestStorageService_RequiresNamespace(t *testing.T) {
	svc := newStorageTestService(t)
	ctx := context.Background()

	if _, err := svc.Get(ctx, &client.GetRequest{Key: "k"}); err == nil {
		t.Error("Get accepted a read with no namespace")
	}
	if _, err := svc.Set(ctx, &client.SetRequest{
		Item: &client.StorageItem{Key: "k", Value: "1"},
	}); err == nil {
		t.Error("Set accepted a write with no namespace")
	}
}

func TestStorageService_CompareAndSet(t *testing.T) {
	address := func(value string) *client.StorageItem {
		return &client.StorageItem{Key: "count", Value: value, Namespace: "woofx3"}
	}

	t.Run("creates a value only when the key is empty", func(t *testing.T) {
		svc := newStorageTestService(t)
		ctx := context.Background()

		first, err := svc.CompareAndSet(ctx, &client.CompareAndSetRequest{Item: address("0"), ExpectAbsent: true})
		if err != nil {
			t.Fatalf("CompareAndSet: %v", err)
		}
		if !first.Swapped || first.Current.GetValue() != "0" {
			t.Fatalf("first write = %+v, want swapped to 0", first)
		}

		second, err := svc.CompareAndSet(ctx, &client.CompareAndSetRequest{Item: address("9"), ExpectAbsent: true})
		if err != nil {
			t.Fatalf("CompareAndSet: %v", err)
		}
		if second.Swapped {
			t.Error("a create went through over an existing value")
		}
		if second.Current.GetValue() != "0" {
			t.Errorf("current = %q, want the value that stopped it, 0", second.Current.GetValue())
		}
	})

	t.Run("updates only from the expected value", func(t *testing.T) {
		svc := newStorageTestService(t)
		ctx := context.Background()
		if _, err := svc.Set(ctx, &client.SetRequest{Item: address("5")}); err != nil {
			t.Fatalf("Set: %v", err)
		}

		stale, err := svc.CompareAndSet(ctx, &client.CompareAndSetRequest{Item: address("7"), ExpectedValue: "4"})
		if err != nil {
			t.Fatalf("CompareAndSet: %v", err)
		}
		if stale.Swapped || stale.Current.GetValue() != "5" {
			t.Errorf("stale write = %+v, want refused with current 5", stale)
		}

		fresh, err := svc.CompareAndSet(ctx, &client.CompareAndSetRequest{Item: address("6"), ExpectedValue: "5"})
		if err != nil {
			t.Fatalf("CompareAndSet: %v", err)
		}
		if !fresh.Swapped || fresh.Current.GetValue() != "6" {
			t.Errorf("fresh write = %+v, want swapped to 6", fresh)
		}
	})

	// The reason the primitive exists: concurrent increments from a
	// read-then-retry loop must all land.
	t.Run("concurrent increments all land", func(t *testing.T) {
		svc := newStorageTestService(t)
		ctx := context.Background()
		if _, err := svc.Set(ctx, &client.SetRequest{Item: address("0")}); err != nil {
			t.Fatalf("Set: %v", err)
		}

		const writers = 20
		done := make(chan error, writers)
		for range writers {
			go func() {
				for {
					current, err := svc.Get(ctx, &client.GetRequest{Key: "count", Namespace: "woofx3"})
					if err != nil {
						done <- err
						return
					}
					var n int
					fmt.Sscan(current.Item.GetValue(), &n)
					resp, err := svc.CompareAndSet(ctx, &client.CompareAndSetRequest{
						Item:          address(fmt.Sprint(n + 1)),
						ExpectedValue: current.Item.GetValue(),
					})
					if err != nil {
						done <- err
						return
					}
					if resp.Swapped {
						done <- nil
						return
					}
				}
			}()
		}
		for range writers {
			if err := <-done; err != nil {
				t.Fatalf("increment: %v", err)
			}
		}

		final, _ := svc.Get(ctx, &client.GetRequest{Key: "count", Namespace: "woofx3"})
		if final.Item.GetValue() != fmt.Sprint(writers) {
			t.Errorf("final = %s, want %d: an increment was lost", final.Item.GetValue(), writers)
		}
	})
}

// The engine announces each cleared key as changed, so it needs to know which.
func TestStorageService_ClearSessionScoped_ReportsWhatItCleared(t *testing.T) {
	svc := newStorageTestService(t)
	ctx := context.Background()

	if _, err := svc.Set(ctx, &client.SetRequest{
		Item: &client.StorageItem{Key: "state:woofx3:counter:deaths", Value: "3", Namespace: "woofx3", ClearOnSessionEnd: true},
	}); err != nil {
		t.Fatalf("Set: %v", err)
	}

	resp, err := svc.ClearSessionScoped(ctx, &client.ClearSessionScopedRequest{})
	if err != nil {
		t.Fatalf("ClearSessionScoped: %v", err)
	}
	if len(resp.ClearedItems) != 1 {
		t.Fatalf("cleared items = %v, want one", resp.ClearedItems)
	}
	item := resp.ClearedItems[0]
	if item.Namespace != "woofx3" || item.Key != "state:woofx3:counter:deaths" {
		t.Errorf("cleared %s/%s, want woofx3/state:woofx3:counter:deaths", item.Namespace, item.Key)
	}
}
