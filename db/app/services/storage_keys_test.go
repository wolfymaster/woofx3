package services

import (
	"encoding/json"
	"testing"

	"github.com/dgraph-io/badger/v3"
)

const (
	appA = "c90da8f4-4938-48fe-ba12-d441a0bbfb8e"
	appB = "ce6e5fab-05d6-4339-9037-41716b908168"
)

func putLegacy(t *testing.T, db *badger.DB, applicationID, namespace, key, value string, createdAt int64) {
	t.Helper()
	encoded, err := json.Marshal(badgerItem{Value: value, CreatedAt: createdAt, Namespace: namespace})
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	raw := []byte(applicationID + "\x00" + namespace + "\x00" + key)
	if err := db.Update(func(txn *badger.Txn) error { return txn.Set(raw, encoded) }); err != nil {
		t.Fatalf("put legacy key: %v", err)
	}
}

func putCurrent(t *testing.T, db *badger.DB, namespace, key, value string) {
	t.Helper()
	encoded, err := json.Marshal(badgerItem{Value: value, Namespace: namespace})
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	if err := db.Update(func(txn *badger.Txn) error { return txn.Set(storageKey(namespace, key), encoded) }); err != nil {
		t.Fatalf("put key: %v", err)
	}
}

// badgerValue is the value stored at a current-layout address, or "" when
// there is none.
func badgerValue(t *testing.T, db *badger.DB, namespace, key string) string {
	t.Helper()
	var item badgerItem
	err := db.View(func(txn *badger.Txn) error {
		entry, err := txn.Get(storageKey(namespace, key))
		if err != nil {
			return err
		}
		return entry.Value(func(val []byte) error { return json.Unmarshal(val, &item) })
	})
	if err == badger.ErrKeyNotFound {
		return ""
	}
	if err != nil {
		t.Fatalf("read %s/%s: %v", namespace, key, err)
	}
	return item.Value
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

	if value := badgerValue(t, db, "woofx3", "state:woofx3:counter:deaths"); value != `{"value":4}` {
		t.Errorf("value = %q, want the legacy value", value)
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

	if value := badgerValue(t, db, "woofx3", "state:x"); value != `{"value":9}` {
		t.Errorf("value = %q, want the later write", value)
	}
	if countKeys(t, db) != 1 {
		t.Errorf("%d keys stored, want 1", countKeys(t, db))
	}
}

func TestMigrateStorageKeys_LeavesCurrentKeysAlone(t *testing.T) {
	db := openStorageTestDB(t)
	// A key may itself contain the separator; only a leading uuid marks a
	// legacy key.
	putCurrent(t, db, "woofx3", "a\x00b", "1")

	moved, err := MigrateStorageKeys(db)
	if err != nil {
		t.Fatalf("MigrateStorageKeys: %v", err)
	}
	if moved != 0 {
		t.Errorf("moved = %d, want 0", moved)
	}
	if value := badgerValue(t, db, "woofx3", "a\x00b"); value != "1" {
		t.Errorf("current key changed: %q", value)
	}
}
