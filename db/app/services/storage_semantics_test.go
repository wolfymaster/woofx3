package services

import (
	"context"
	"sort"
	"testing"
	"time"

	client "github.com/wolfymaster/woofx3/clients/db"
)

// These tests pin the observable contract of `ctx.storage` -- what a module
// and the engine can rely on through StorageService -- independently of the
// store behind it. Expiry is exercised with timestamps already in the past or
// far in the future, so no test depends on the clock ticking.

func storageItem(namespace, key, value string) *client.StorageItem {
	return &client.StorageItem{Namespace: namespace, Key: key, Value: value}
}

func mustSet(t *testing.T, svc client.StorageService, item *client.StorageItem) {
	t.Helper()
	if _, err := svc.Set(context.Background(), &client.SetRequest{Item: item}); err != nil {
		t.Fatalf("Set %s/%s: %v", item.Namespace, item.Key, err)
	}
}

func mustGet(t *testing.T, svc client.StorageService, namespace, key string) *client.StorageItem {
	t.Helper()
	resp, err := svc.Get(context.Background(), &client.GetRequest{Namespace: namespace, Key: key})
	if err != nil {
		t.Fatalf("Get %s/%s: %v", namespace, key, err)
	}
	return resp.Item
}

func mustCompareAndSet(t *testing.T, svc client.StorageService, req *client.CompareAndSetRequest) *client.CompareAndSetResponse {
	t.Helper()
	resp, err := svc.CompareAndSet(context.Background(), req)
	if err != nil {
		t.Fatalf("CompareAndSet: %v", err)
	}
	return resp
}

func pastUnix() int64 {
	return time.Now().Add(-time.Hour).Unix()
}

func futureUnix() int64 {
	return time.Now().Add(time.Hour).Unix()
}

func TestStorageSemantics_Get(t *testing.T) {
	t.Run("returns every stored field", func(t *testing.T) {
		svc := newStorageTestService(t)
		expires := futureUnix()
		mustSet(t, svc, &client.StorageItem{
			Namespace: "mod", Key: "k", Value: "v", ExpiresAt: expires, ClearOnSessionEnd: true,
		})

		item := mustGet(t, svc, "mod", "k")
		if item == nil {
			t.Fatal("expected the stored item")
		}
		if item.Namespace != "mod" || item.Key != "k" || item.Value != "v" {
			t.Errorf("address/value = %s/%s=%q, want mod/k=\"v\"", item.Namespace, item.Key, item.Value)
		}
		if item.ExpiresAt != expires {
			t.Errorf("expires_at = %d, want %d", item.ExpiresAt, expires)
		}
		if !item.ClearOnSessionEnd {
			t.Error("clear_on_session_end was not kept")
		}
	})

	t.Run("an expired item reads as absent", func(t *testing.T) {
		svc := newStorageTestService(t)
		mustSet(t, svc, &client.StorageItem{Namespace: "mod", Key: "k", Value: "v", ExpiresAt: pastUnix()})

		if item := mustGet(t, svc, "mod", "k"); item != nil {
			t.Errorf("expired item read back as %+v", item)
		}
	})

	t.Run("an item expiring later reads normally", func(t *testing.T) {
		svc := newStorageTestService(t)
		mustSet(t, svc, &client.StorageItem{Namespace: "mod", Key: "k", Value: "v", ExpiresAt: futureUnix()})

		if item := mustGet(t, svc, "mod", "k"); item == nil || item.Value != "v" {
			t.Errorf("unexpired item read back as %+v", item)
		}
	})

	t.Run("values are kept byte for byte", func(t *testing.T) {
		svc := newStorageTestService(t)
		value := "{\"a\": [1, 2]}\n\ttrailing space éè "
		mustSet(t, svc, storageItem("mod", "json", value))

		if item := mustGet(t, svc, "mod", "json"); item == nil || item.Value != value {
			t.Errorf("value = %+v, want %q", item, value)
		}
	})
}

func TestStorageSemantics_Set(t *testing.T) {
	t.Run("created_at is set by the server, not the caller", func(t *testing.T) {
		svc := newStorageTestService(t)
		before := time.Now().Unix()
		mustSet(t, svc, &client.StorageItem{Namespace: "mod", Key: "k", Value: "v", CreatedAt: 42})
		after := time.Now().Unix()

		item := mustGet(t, svc, "mod", "k")
		if item.CreatedAt < before || item.CreatedAt > after {
			t.Errorf("created_at = %d, want between %d and %d", item.CreatedAt, before, after)
		}
	})

	t.Run("an overwrite replaces expiry and session flag", func(t *testing.T) {
		svc := newStorageTestService(t)
		mustSet(t, svc, &client.StorageItem{Namespace: "mod", Key: "k", Value: "1", ExpiresAt: futureUnix(), ClearOnSessionEnd: true})
		mustSet(t, svc, storageItem("mod", "k", "2"))

		item := mustGet(t, svc, "mod", "k")
		if item.Value != "2" || item.ExpiresAt != 0 || item.ClearOnSessionEnd {
			t.Errorf("after overwrite = %+v, want value 2, no expiry, not session scoped", item)
		}
	})

	t.Run("a write over an expired item revives the key", func(t *testing.T) {
		svc := newStorageTestService(t)
		mustSet(t, svc, &client.StorageItem{Namespace: "mod", Key: "k", Value: "old", ExpiresAt: pastUnix()})
		mustSet(t, svc, storageItem("mod", "k", "new"))

		if item := mustGet(t, svc, "mod", "k"); item == nil || item.Value != "new" {
			t.Errorf("item = %+v, want new", item)
		}
	})

	t.Run("refuses an item without an address", func(t *testing.T) {
		svc := newStorageTestService(t)
		ctx := context.Background()
		if _, err := svc.Set(ctx, &client.SetRequest{}); err == nil {
			t.Error("Set accepted a request with no item")
		}
		if _, err := svc.Set(ctx, &client.SetRequest{Item: storageItem("mod", " ", "v")}); err == nil {
			t.Error("Set accepted a blank key")
		}
	})
}

func TestStorageSemantics_Delete(t *testing.T) {
	t.Run("deleting a missing key succeeds", func(t *testing.T) {
		svc := newStorageTestService(t)
		if _, err := svc.Delete(context.Background(), &client.DeleteRequest{Namespace: "mod", Key: "never"}); err != nil {
			t.Errorf("Delete of a missing key: %v", err)
		}
	})

	t.Run("deletes only the addressed key", func(t *testing.T) {
		svc := newStorageTestService(t)
		mustSet(t, svc, storageItem("mod", "a", "1"))
		mustSet(t, svc, storageItem("mod", "b", "2"))
		mustSet(t, svc, storageItem("other", "a", "3"))

		if _, err := svc.Delete(context.Background(), &client.DeleteRequest{Namespace: "mod", Key: "a"}); err != nil {
			t.Fatalf("Delete: %v", err)
		}
		if item := mustGet(t, svc, "mod", "a"); item != nil {
			t.Errorf("mod/a survived its delete: %+v", item)
		}
		if item := mustGet(t, svc, "mod", "b"); item == nil {
			t.Error("mod/b was deleted with mod/a")
		}
		if item := mustGet(t, svc, "other", "a"); item == nil {
			t.Error("other/a was deleted with mod/a")
		}
	})
}

func TestStorageSemantics_CompareAndSetExpectValue(t *testing.T) {
	t.Run("a match swaps and returns the written item", func(t *testing.T) {
		svc := newStorageTestService(t)
		mustSet(t, svc, storageItem("mod", "k", "1"))

		resp := mustCompareAndSet(t, svc, &client.CompareAndSetRequest{
			Item:          &client.StorageItem{Namespace: "mod", Key: "k", Value: "2", ClearOnSessionEnd: true},
			ExpectedValue: "1",
		})
		if !resp.Swapped {
			t.Fatal("matching expected value did not swap")
		}
		current := resp.Current
		if current.GetNamespace() != "mod" || current.GetKey() != "k" || current.GetValue() != "2" || !current.GetClearOnSessionEnd() || current.GetCreatedAt() == 0 {
			t.Errorf("current = %+v, want the written item", current)
		}
		if item := mustGet(t, svc, "mod", "k"); item.Value != "2" || !item.ClearOnSessionEnd {
			t.Errorf("stored = %+v, want the written item", item)
		}
	})

	t.Run("a mismatch leaves the value and returns it", func(t *testing.T) {
		svc := newStorageTestService(t)
		mustSet(t, svc, storageItem("mod", "k", "1"))

		resp := mustCompareAndSet(t, svc, &client.CompareAndSetRequest{Item: storageItem("mod", "k", "2"), ExpectedValue: "0"})
		if resp.Swapped || resp.Current.GetValue() != "1" {
			t.Errorf("mismatch = %+v, want refused with current 1", resp)
		}
		if item := mustGet(t, svc, "mod", "k"); item.Value != "1" {
			t.Errorf("stored = %q after a refused swap, want 1", item.Value)
		}
	})

	t.Run("the comparison is exact", func(t *testing.T) {
		svc := newStorageTestService(t)
		mustSet(t, svc, storageItem("mod", "k", "abc"))

		for _, expected := range []string{"ABC", "abc ", " abc", "ab"} {
			resp := mustCompareAndSet(t, svc, &client.CompareAndSetRequest{Item: storageItem("mod", "k", "x"), ExpectedValue: expected})
			if resp.Swapped {
				t.Errorf("expected %q swapped over stored \"abc\"", expected)
			}
		}
	})

	t.Run("a missing key does not match any expected value", func(t *testing.T) {
		svc := newStorageTestService(t)

		for _, expected := range []string{"", "1"} {
			resp := mustCompareAndSet(t, svc, &client.CompareAndSetRequest{Item: storageItem("mod", "k", "2"), ExpectedValue: expected})
			if resp.Swapped || resp.Current != nil {
				t.Errorf("expected %q over a missing key = %+v, want refused with no current", expected, resp)
			}
		}
		if item := mustGet(t, svc, "mod", "k"); item != nil {
			t.Errorf("refused swap created %+v", item)
		}
	})

	t.Run("an expired item does not match its old value", func(t *testing.T) {
		svc := newStorageTestService(t)
		mustSet(t, svc, &client.StorageItem{Namespace: "mod", Key: "k", Value: "1", ExpiresAt: pastUnix()})

		resp := mustCompareAndSet(t, svc, &client.CompareAndSetRequest{Item: storageItem("mod", "k", "2"), ExpectedValue: "1"})
		if resp.Swapped || resp.Current != nil {
			t.Errorf("swap over expired item = %+v, want refused with no current", resp)
		}
		if item := mustGet(t, svc, "mod", "k"); item != nil {
			t.Errorf("expired key now reads %+v", item)
		}
	})

	t.Run("a swap can set an expiry", func(t *testing.T) {
		svc := newStorageTestService(t)
		mustSet(t, svc, storageItem("mod", "k", "1"))
		expires := futureUnix()

		resp := mustCompareAndSet(t, svc, &client.CompareAndSetRequest{
			Item:          &client.StorageItem{Namespace: "mod", Key: "k", Value: "2", ExpiresAt: expires},
			ExpectedValue: "1",
		})
		if !resp.Swapped || resp.Current.GetExpiresAt() != expires {
			t.Errorf("swap = %+v, want swapped with expires_at %d", resp, expires)
		}
	})
}

func TestStorageSemantics_CompareAndSetExpectAbsent(t *testing.T) {
	t.Run("creates a missing key", func(t *testing.T) {
		svc := newStorageTestService(t)

		resp := mustCompareAndSet(t, svc, &client.CompareAndSetRequest{Item: storageItem("mod", "k", "1"), ExpectAbsent: true})
		if !resp.Swapped || resp.Current.GetValue() != "1" {
			t.Errorf("create = %+v, want swapped to 1", resp)
		}
	})

	t.Run("an expired item counts as absent", func(t *testing.T) {
		svc := newStorageTestService(t)
		mustSet(t, svc, &client.StorageItem{Namespace: "mod", Key: "k", Value: "old", ExpiresAt: pastUnix(), ClearOnSessionEnd: true})

		resp := mustCompareAndSet(t, svc, &client.CompareAndSetRequest{Item: storageItem("mod", "k", "new"), ExpectAbsent: true})
		if !resp.Swapped || resp.Current.GetValue() != "new" {
			t.Fatalf("create over expired = %+v, want swapped to new", resp)
		}
		item := mustGet(t, svc, "mod", "k")
		if item == nil || item.Value != "new" || item.ExpiresAt != 0 || item.ClearOnSessionEnd {
			t.Errorf("stored = %+v, want a fresh item with nothing kept from the expired one", item)
		}
	})

	t.Run("a live item blocks the create and is returned", func(t *testing.T) {
		svc := newStorageTestService(t)
		mustSet(t, svc, &client.StorageItem{Namespace: "mod", Key: "k", Value: "1", ExpiresAt: futureUnix()})

		resp := mustCompareAndSet(t, svc, &client.CompareAndSetRequest{Item: storageItem("mod", "k", "2"), ExpectAbsent: true})
		if resp.Swapped || resp.Current.GetValue() != "1" {
			t.Errorf("create over live = %+v, want refused with current 1", resp)
		}
	})

	t.Run("expect-absent ignores the expected value", func(t *testing.T) {
		svc := newStorageTestService(t)
		mustSet(t, svc, storageItem("mod", "k", "1"))

		resp := mustCompareAndSet(t, svc, &client.CompareAndSetRequest{Item: storageItem("mod", "k", "2"), ExpectAbsent: true, ExpectedValue: "1"})
		if resp.Swapped {
			t.Error("expect-absent swapped over a live value because expected_value matched")
		}
	})
}

func TestStorageSemantics_CompareAndSetValidation(t *testing.T) {
	svc := newStorageTestService(t)
	ctx := context.Background()
	if _, err := svc.CompareAndSet(ctx, &client.CompareAndSetRequest{ExpectAbsent: true}); err == nil {
		t.Error("CompareAndSet accepted a request with no item")
	}
	if _, err := svc.CompareAndSet(ctx, &client.CompareAndSetRequest{Item: storageItem("", "k", "v"), ExpectAbsent: true}); err == nil {
		t.Error("CompareAndSet accepted an item with no namespace")
	}
}

func TestStorageSemantics_ClearNamespace(t *testing.T) {
	t.Run("clears live and expired items of that namespace only", func(t *testing.T) {
		svc := newStorageTestService(t)
		mustSet(t, svc, storageItem("a", "1", "x"))
		mustSet(t, svc, &client.StorageItem{Namespace: "a", Key: "2", Value: "x", ExpiresAt: pastUnix()})
		mustSet(t, svc, storageItem("ab", "1", "x"))
		mustSet(t, svc, storageItem("b", "1", "x"))

		if _, err := svc.ClearNamespace(context.Background(), &client.ClearNamespaceRequest{Namespace: "a"}); err != nil {
			t.Fatalf("ClearNamespace: %v", err)
		}
		if item := mustGet(t, svc, "a", "1"); item != nil {
			t.Errorf("a/1 survived: %+v", item)
		}
		// A namespace that merely starts with the cleared one is a different module.
		if item := mustGet(t, svc, "ab", "1"); item == nil {
			t.Error("ab/1 was cleared with namespace a")
		}
		if item := mustGet(t, svc, "b", "1"); item == nil {
			t.Error("b/1 was cleared with namespace a")
		}
		// The expired item is gone too: expect-absent creates with no trace of it.
		resp := mustCompareAndSet(t, svc, &client.CompareAndSetRequest{Item: storageItem("a", "2", "y"), ExpectAbsent: true})
		if !resp.Swapped {
			t.Error("a/2 could not be recreated after the clear")
		}
	})

	t.Run("requires a namespace", func(t *testing.T) {
		svc := newStorageTestService(t)
		if _, err := svc.ClearNamespace(context.Background(), &client.ClearNamespaceRequest{Namespace: " "}); err == nil {
			t.Error("ClearNamespace accepted a blank namespace")
		}
	})
}

func TestStorageSemantics_ClearExpired(t *testing.T) {
	svc := newStorageTestService(t)
	mustSet(t, svc, &client.StorageItem{Namespace: "mod", Key: "expired", Value: "x", ExpiresAt: pastUnix(), ClearOnSessionEnd: true})
	mustSet(t, svc, &client.StorageItem{Namespace: "other", Key: "expired", Value: "x", ExpiresAt: pastUnix(), ClearOnSessionEnd: true})
	mustSet(t, svc, &client.StorageItem{Namespace: "mod", Key: "later", Value: "x", ExpiresAt: futureUnix()})
	mustSet(t, svc, storageItem("mod", "forever", "x"))

	if _, err := svc.ClearExpired(context.Background(), &client.ClearExpiredRequest{}); err != nil {
		t.Fatalf("ClearExpired: %v", err)
	}
	if item := mustGet(t, svc, "mod", "later"); item == nil {
		t.Error("an item that has not expired yet was cleared")
	}
	if item := mustGet(t, svc, "mod", "forever"); item == nil {
		t.Error("an item with no expiry was cleared")
	}

	// Expired items read as absent either way; a session clear reports every
	// flagged item it deletes, expired or not, so it shows whether they are gone.
	mustSet(t, svc, &client.StorageItem{Namespace: "mod", Key: "session", Value: "x", ClearOnSessionEnd: true})
	resp, err := svc.ClearSessionScoped(context.Background(), &client.ClearSessionScopedRequest{})
	if err != nil {
		t.Fatalf("ClearSessionScoped: %v", err)
	}
	if resp.Cleared != 1 {
		t.Errorf("cleared = %d, want 1", resp.Cleared)
	}
}

func TestStorageSemantics_ClearSessionScoped(t *testing.T) {
	t.Run("clears every flagged item, expired ones included, and reports each", func(t *testing.T) {
		svc := newStorageTestService(t)
		mustSet(t, svc, &client.StorageItem{Namespace: "a", Key: "1", Value: "x", ClearOnSessionEnd: true})
		mustSet(t, svc, &client.StorageItem{Namespace: "b", Key: "2", Value: "x", ClearOnSessionEnd: true, ExpiresAt: futureUnix()})
		mustSet(t, svc, &client.StorageItem{Namespace: "b", Key: "3", Value: "x", ClearOnSessionEnd: true, ExpiresAt: pastUnix()})
		mustSet(t, svc, storageItem("a", "kept", "x"))
		mustSet(t, svc, &client.StorageItem{Namespace: "b", Key: "kept", Value: "x", ExpiresAt: futureUnix()})

		resp, err := svc.ClearSessionScoped(context.Background(), &client.ClearSessionScopedRequest{})
		if err != nil {
			t.Fatalf("ClearSessionScoped: %v", err)
		}
		if resp.Cleared != 3 {
			t.Errorf("cleared = %d, want 3", resp.Cleared)
		}
		var reported []string
		for _, item := range resp.ClearedItems {
			reported = append(reported, item.Namespace+"/"+item.Key)
		}
		sort.Strings(reported)
		want := []string{"a/1", "b/2", "b/3"}
		if len(reported) != len(want) {
			t.Fatalf("reported %v, want %v", reported, want)
		}
		for i := range want {
			if reported[i] != want[i] {
				t.Fatalf("reported %v, want %v", reported, want)
			}
		}
		if item := mustGet(t, svc, "a", "kept"); item == nil {
			t.Error("unflagged a/kept was cleared")
		}
		if item := mustGet(t, svc, "b", "kept"); item == nil {
			t.Error("unflagged b/kept was cleared")
		}
	})

	t.Run("a second clear finds nothing", func(t *testing.T) {
		svc := newStorageTestService(t)
		mustSet(t, svc, &client.StorageItem{Namespace: "a", Key: "1", Value: "x", ClearOnSessionEnd: true})
		if _, err := svc.ClearSessionScoped(context.Background(), &client.ClearSessionScopedRequest{}); err != nil {
			t.Fatalf("ClearSessionScoped: %v", err)
		}

		resp, err := svc.ClearSessionScoped(context.Background(), &client.ClearSessionScopedRequest{})
		if err != nil {
			t.Fatalf("ClearSessionScoped: %v", err)
		}
		if resp.Cleared != 0 || len(resp.ClearedItems) != 0 {
			t.Errorf("second clear = %+v, want nothing", resp)
		}
	})
}
