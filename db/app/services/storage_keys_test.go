package services

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/dgraph-io/badger/v3"
	client "github.com/wolfymaster/woofx3/clients/db"
)

const (
	appA = "c90da8f4-4938-48fe-ba12-d441a0bbfb8e"
	appB = "ce6e5fab-05d6-4339-9037-41716b908168"
)

func putLegacy(t *testing.T, db *badger.DB, applicationID, namespace, key, value string, createdAt int64) {
	t.Helper()
	encoded, err := json.Marshal(storedItem{Value: value, CreatedAt: createdAt, Namespace: namespace})
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	raw := []byte(applicationID + "\x00" + namespace + "\x00" + key)
	if err := db.Update(func(txn *badger.Txn) error { return txn.Set(raw, encoded) }); err != nil {
		t.Fatalf("put legacy key: %v", err)
	}
}

func openStorageTestDB(t *testing.T) *badger.DB {
	t.Helper()
	db, err := badger.Open(badger.DefaultOptions("").WithInMemory(true).WithLoggingLevel(badger.ERROR))
	if err != nil {
		t.Fatalf("open in-memory badger: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func countKeys(t *testing.T, db *badger.DB) int {
	t.Helper()
	count := 0
	_ = db.View(func(txn *badger.Txn) error {
		it := txn.NewIterator(badger.DefaultIteratorOptions)
		defer it.Close()
		for it.Rewind(); it.Valid(); it.Next() {
			count++
		}
		return nil
	})
	return count
}

func TestMigrateStorageKeys_MovesLegacyKeysToNamespaceAndKey(t *testing.T) {
	db := openStorageTestDB(t)
	putLegacy(t, db, appA, "woofx3", "state:woofx3:counter:deaths", `{"value":4}`, 100)

	moved, err := MigrateStorageKeys(db)
	if err != nil {
		t.Fatalf("MigrateStorageKeys: %v", err)
	}
	if moved != 1 {
		t.Errorf("moved = %d, want 1", moved)
	}

	resp, err := NewStorageService(db).Get(context.Background(), &client.GetRequest{
		Namespace: "woofx3",
		Key:       "state:woofx3:counter:deaths",
	})
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if resp.Item.GetValue() != `{"value":4}` {
		t.Errorf("value = %q, want the legacy value", resp.Item.GetValue())
	}
	if countKeys(t, db) != 1 {
		t.Errorf("legacy key left behind: %d keys stored, want 1", countKeys(t, db))
	}
}

func TestMigrateStorageKeys_LastWriteWinsWhenApplicationsCollide(t *testing.T) {
	db := openStorageTestDB(t)
	putLegacy(t, db, appB, "woofx3", "state:x", `{"value":9}`, 200)
	putLegacy(t, db, appA, "woofx3", "state:x", `{"value":1}`, 100)

	if _, err := MigrateStorageKeys(db); err != nil {
		t.Fatalf("MigrateStorageKeys: %v", err)
	}

	resp, _ := NewStorageService(db).Get(context.Background(), &client.GetRequest{Namespace: "woofx3", Key: "state:x"})
	if resp.Item.GetValue() != `{"value":9}` {
		t.Errorf("value = %q, want the later write", resp.Item.GetValue())
	}
	if countKeys(t, db) != 1 {
		t.Errorf("%d keys stored, want 1", countKeys(t, db))
	}
}

func TestMigrateStorageKeys_LeavesCurrentKeysAlone(t *testing.T) {
	db := openStorageTestDB(t)
	svc := NewStorageService(db)
	ctx := context.Background()
	// A key may itself contain the separator; only a leading uuid marks a
	// legacy key.
	if _, err := svc.Set(ctx, &client.SetRequest{
		Item: &client.StorageItem{Namespace: "woofx3", Key: "a\x00b", Value: "1"},
	}); err != nil {
		t.Fatalf("Set: %v", err)
	}

	moved, err := MigrateStorageKeys(db)
	if err != nil {
		t.Fatalf("MigrateStorageKeys: %v", err)
	}
	if moved != 0 {
		t.Errorf("moved = %d, want 0", moved)
	}
	resp, _ := svc.Get(ctx, &client.GetRequest{Namespace: "woofx3", Key: "a\x00b"})
	if resp.Item.GetValue() != "1" {
		t.Errorf("current key changed: %+v", resp.Item)
	}
}
