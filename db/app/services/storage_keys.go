package services

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/dgraph-io/badger/v3"
	"github.com/google/uuid"
)

// legacyStorageKey is a key written when storage was scoped by application as
// well as namespace: "<application uuid>\x00<namespace>\x00<key>".
type legacyStorageKey struct {
	raw   []byte
	value []byte
}

// splitLegacyStorageKey returns the current-layout key a legacy key moves to,
// or false when raw is already in the current layout. A legacy key is
// recognised by its leading application uuid: a namespace is a module's
// manifest id, never a uuid, so a current key cannot be mistaken for one.
func splitLegacyStorageKey(raw []byte) ([]byte, bool) {
	parts := strings.SplitN(string(raw), "\x00", 3)
	if len(parts) != 3 {
		return nil, false
	}
	if _, err := uuid.Parse(parts[0]); err != nil {
		return nil, false
	}
	return storageKey(parts[1], parts[2]), true
}

// MigrateStorageKeys moves every value stored under the legacy
// application-scoped layout to its (namespace, key) address, and returns how
// many keys it moved.
//
// Two applications may hold a value under the same namespace and key; the one
// written last wins, because it is the value the engine was using most
// recently. Running it again finds nothing to move, so it is safe on every
// start.
func MigrateStorageKeys(db *badger.DB) (int, error) {
	var legacy []legacyStorageKey
	err := db.View(func(txn *badger.Txn) error {
		it := txn.NewIterator(badger.DefaultIteratorOptions)
		defer it.Close()
		for it.Rewind(); it.Valid(); it.Next() {
			item := it.Item()
			if _, ok := splitLegacyStorageKey(item.Key()); !ok {
				continue
			}
			value, err := item.ValueCopy(nil)
			if err != nil {
				return err
			}
			legacy = append(legacy, legacyStorageKey{raw: item.KeyCopy(nil), value: value})
		}
		return nil
	})
	if err != nil {
		return 0, fmt.Errorf("scan legacy storage keys: %w", err)
	}

	for _, entry := range legacy {
		target, _ := splitLegacyStorageKey(entry.raw)
		err := db.Update(func(txn *badger.Txn) error {
			keep, err := newerThanStored(txn, target, entry.value)
			if err != nil {
				return err
			}
			if keep {
				if err := txn.Set(target, entry.value); err != nil {
					return err
				}
			}
			return txn.Delete(entry.raw)
		})
		if err != nil {
			return 0, fmt.Errorf("move legacy storage key %q: %w", entry.raw, err)
		}
	}
	return len(legacy), nil
}

// newerThanStored reports whether value should replace what target holds: it
// does when target is empty, or when value was written later.
func newerThanStored(txn *badger.Txn, target []byte, value []byte) (bool, error) {
	existing, err := txn.Get(target)
	if err == badger.ErrKeyNotFound {
		return true, nil
	}
	if err != nil {
		return false, err
	}
	var stored storedItem
	if err := existing.Value(func(val []byte) error {
		return json.Unmarshal(val, &stored)
	}); err != nil {
		return false, err
	}
	var incoming storedItem
	if err := json.Unmarshal(value, &incoming); err != nil {
		return false, err
	}
	return incoming.CreatedAt > stored.CreatedAt, nil
}
