package services

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/dgraph-io/badger/v3"
	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
)

// StorageService backs `ctx.storage` for sandboxed module functions (see
// barkloader's CtxStorage / storage.proto). A value is addressed by namespace
// and key (badger key = "<namespace>\x00<key>"): the namespace -- the owning
// module's manifest id -- keeps modules apart, so two modules using the same
// key never read each other's values.
type storageService struct {
	db *badger.DB
}

func NewStorageService(db *badger.DB) *storageService {
	return &storageService{db: db}
}

// storedItem is the JSON envelope persisted in badger. Mirrors StorageItem
// minus the key, which the badger key already holds.
type storedItem struct {
	Value             string `json:"value"`
	CreatedAt         int64  `json:"createdAt"`
	ExpiresAt         int64  `json:"expiresAt"`
	Namespace         string `json:"namespace"`
	ClearOnSessionEnd bool   `json:"clearOnSessionEnd"`
}

func storageKey(namespace, key string) []byte {
	return []byte(namespace + "\x00" + key)
}

// splitStorageKey recovers the namespace and key from a badger key, for the
// bulk operations that report what they touched.
func splitStorageKey(raw []byte) (namespace, key string) {
	parts := strings.SplitN(string(raw), "\x00", 2)
	if len(parts) != 2 {
		return "", string(raw)
	}
	return parts[0], parts[1]
}

// requireAddress refuses a read or write that does not say whose value it is.
func requireAddress(namespace, key, prefix string) error {
	if strings.TrimSpace(key) == "" {
		return twirp.RequiredArgumentError(prefix + "key")
	}
	if strings.TrimSpace(namespace) == "" {
		return twirp.RequiredArgumentError(prefix + "namespace")
	}
	return nil
}

// readItem returns the live item at a badger key, or nil when there is none or
// it has expired.
func readItem(txn *badger.Txn, key []byte) (*storedItem, error) {
	entry, err := txn.Get(key)
	if err == badger.ErrKeyNotFound {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var decoded storedItem
	if err := entry.Value(func(val []byte) error {
		return json.Unmarshal(val, &decoded)
	}); err != nil {
		return nil, err
	}
	if isExpired(decoded.ExpiresAt) {
		return nil, nil
	}
	return &decoded, nil
}

func toStorageItem(namespace, key string, item *storedItem) *client.StorageItem {
	return &client.StorageItem{
		Key:               key,
		Value:             item.Value,
		CreatedAt:         item.CreatedAt,
		ExpiresAt:         item.ExpiresAt,
		Namespace:         namespace,
		ClearOnSessionEnd: item.ClearOnSessionEnd,
	}
}

// isExpired reports whether a stored item is past its expiry. expiresAt == 0
// means "never expires" (proto contract).
func isExpired(expiresAt int64) bool {
	return expiresAt != 0 && expiresAt <= time.Now().Unix()
}

func (s *storageService) Get(ctx context.Context, req *client.GetRequest) (*client.GetResponse, error) {
	if err := requireAddress(req.Namespace, req.Key, ""); err != nil {
		return nil, err
	}

	var item *storedItem
	err := s.db.View(func(txn *badger.Txn) error {
		var err error
		item, err = readItem(txn, storageKey(req.Namespace, req.Key))
		return err
	})
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("get storage item: %w", err))
	}
	if item == nil {
		return &client.GetResponse{}, nil
	}
	return &client.GetResponse{Item: toStorageItem(req.Namespace, req.Key, item)}, nil
}

func (s *storageService) Set(ctx context.Context, req *client.SetRequest) (*client.SetResponse, error) {
	if req.Item == nil {
		return nil, twirp.RequiredArgumentError("item")
	}
	if err := requireAddress(req.Item.Namespace, req.Item.Key, "item."); err != nil {
		return nil, err
	}

	encoded, err := encodeItem(req.Item)
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("encode storage item: %w", err))
	}

	err = s.db.Update(func(txn *badger.Txn) error {
		return txn.Set(storageKey(req.Item.Namespace, req.Item.Key), encoded)
	})
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("set storage item: %w", err))
	}
	return &client.SetResponse{}, nil
}

// encodeItem is the envelope persisted for a write. created_at is
// server-authoritative: callers (the sandbox `ctx.storage` binding) have no way
// to set it meaningfully.
func encodeItem(item *client.StorageItem) ([]byte, error) {
	return json.Marshal(storedItem{
		Value:             item.Value,
		CreatedAt:         time.Now().Unix(),
		ExpiresAt:         item.ExpiresAt,
		Namespace:         item.Namespace,
		ClearOnSessionEnd: item.ClearOnSessionEnd,
	})
}

// CompareAndSet writes only if the key holds what the caller expects, in one
// transaction.
//
// Badger detects a concurrent write to the same key at commit and refuses the
// later transaction; that refusal is reported as a failed swap with the value
// now stored, which is exactly what the caller retries from.
func (s *storageService) CompareAndSet(ctx context.Context, req *client.CompareAndSetRequest) (*client.CompareAndSetResponse, error) {
	if req.Item == nil {
		return nil, twirp.RequiredArgumentError("item")
	}
	if err := requireAddress(req.Item.Namespace, req.Item.Key, "item."); err != nil {
		return nil, err
	}
	key := storageKey(req.Item.Namespace, req.Item.Key)

	encoded, err := encodeItem(req.Item)
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("encode storage item: %w", err))
	}

	var current *storedItem
	swapped := false
	err = s.db.Update(func(txn *badger.Txn) error {
		existing, err := readItem(txn, key)
		if err != nil {
			return err
		}
		matches := existing == nil && req.ExpectAbsent ||
			existing != nil && !req.ExpectAbsent && existing.Value == req.ExpectedValue
		if !matches {
			current = existing
			return nil
		}
		if err := txn.Set(key, encoded); err != nil {
			return err
		}
		var written storedItem
		if err := json.Unmarshal(encoded, &written); err != nil {
			return err
		}
		current = &written
		swapped = true
		return nil
	})
	if err == badger.ErrConflict {
		swapped = false
		err = s.db.View(func(txn *badger.Txn) error {
			var readErr error
			current, readErr = readItem(txn, key)
			return readErr
		})
	}
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("compare and set storage item: %w", err))
	}

	response := &client.CompareAndSetResponse{Swapped: swapped}
	if current != nil {
		response.Current = toStorageItem(req.Item.Namespace, req.Item.Key, current)
	}
	return response, nil
}

func (s *storageService) Delete(ctx context.Context, req *client.DeleteRequest) (*client.DeleteResponse, error) {
	if err := requireAddress(req.Namespace, req.Key, ""); err != nil {
		return nil, err
	}

	err := s.db.Update(func(txn *badger.Txn) error {
		err := txn.Delete(storageKey(req.Namespace, req.Key))
		if err == badger.ErrKeyNotFound {
			return nil
		}
		return err
	})
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("delete storage item: %w", err))
	}
	return &client.DeleteResponse{}, nil
}

// deleteWhere scans every key, deletes the ones `shouldDelete` accepts, and
// reports each one it removed as (namespace, key). Shared by ClearNamespace /
// ClearExpired / ClearSessionScoped — none of these are hot-path operations,
// so a full scan (rather than a secondary index) keeps this simple.
func (s *storageService) deleteWhere(shouldDelete func(item storedItem) bool) ([]*client.StorageItem, error) {
	var deleted []*client.StorageItem
	err := s.db.Update(func(txn *badger.Txn) error {
		it := txn.NewIterator(badger.DefaultIteratorOptions)
		defer it.Close()

		var keysToDelete [][]byte
		for it.Rewind(); it.Valid(); it.Next() {
			item := it.Item()
			var decoded storedItem
			err := item.Value(func(val []byte) error {
				return json.Unmarshal(val, &decoded)
			})
			if err != nil {
				return err
			}
			if shouldDelete(decoded) {
				key := make([]byte, len(item.Key()))
				copy(key, item.Key())
				keysToDelete = append(keysToDelete, key)
			}
		}
		for _, key := range keysToDelete {
			if err := txn.Delete(key); err != nil {
				return err
			}
			namespace, itemKey := splitStorageKey(key)
			deleted = append(deleted, &client.StorageItem{
				Key:       itemKey,
				Namespace: namespace,
			})
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return deleted, nil
}

func (s *storageService) ClearNamespace(ctx context.Context, req *client.ClearNamespaceRequest) (*client.ClearNamespaceResponse, error) {
	if strings.TrimSpace(req.Namespace) == "" {
		return nil, twirp.RequiredArgumentError("namespace")
	}
	_, err := s.deleteWhere(func(item storedItem) bool {
		return item.Namespace == req.Namespace
	})
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("clear namespace: %w", err))
	}
	return &client.ClearNamespaceResponse{}, nil
}

func (s *storageService) ClearExpired(ctx context.Context, req *client.ClearExpiredRequest) (*client.ClearExpiredResponse, error) {
	_, err := s.deleteWhere(func(item storedItem) bool {
		return isExpired(item.ExpiresAt)
	})
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("clear expired: %w", err))
	}
	return &client.ClearExpiredResponse{}, nil
}

// ClearSessionScoped drops every key flagged
// `clear_on_session_end`. Called by the engine when a stream session ends.
//
// Clearing is the engine's job rather than a module's: the sandbox exposes only
// `get` and `set`, so a module declares that a key is session-scoped and the
// engine acts on the declaration.
func (s *storageService) ClearSessionScoped(ctx context.Context, req *client.ClearSessionScopedRequest) (*client.ClearSessionScopedResponse, error) {
	cleared, err := s.deleteWhere(func(item storedItem) bool {
		return item.ClearOnSessionEnd
	})
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("clear session scoped: %w", err))
	}
	return &client.ClearSessionScopedResponse{Cleared: int32(len(cleared)), ClearedItems: cleared}, nil
}
