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
// barkloader's CtxStorage / storage.proto). Keys are scoped per
// application (badger key = "<application_id>\x00<key>") so one barkloader
// process serving multiple applications never lets one tenant see
// another's values. `namespace` is caller-supplied metadata used only by
// ClearNamespace's bulk delete — it is not part of the lookup key, since
// Get/Delete requests don't carry it.
type storageService struct {
	db *badger.DB
}

func NewStorageService(db *badger.DB) *storageService {
	return &storageService{db: db}
}

// storedItem is the JSON envelope persisted in badger. Mirrors StorageItem
// minus the fields already implied by the badger key (key, application_id).
type storedItem struct {
	Value             string `json:"value"`
	CreatedAt         int64  `json:"createdAt"`
	ExpiresAt         int64  `json:"expiresAt"`
	Namespace         string `json:"namespace"`
	ClearOnSessionEnd bool   `json:"clearOnSessionEnd"`
}

func storageKey(applicationID, key string) []byte {
	return []byte(applicationID + "\x00" + key)
}

// isExpired reports whether a stored item is past its expiry. expiresAt == 0
// means "never expires" (proto contract).
func isExpired(expiresAt int64) bool {
	return expiresAt != 0 && expiresAt <= time.Now().Unix()
}

func (s *storageService) Get(ctx context.Context, req *client.GetRequest) (*client.GetResponse, error) {
	if strings.TrimSpace(req.Key) == "" {
		return nil, twirp.RequiredArgumentError("key")
	}
	if strings.TrimSpace(req.ApplicationId) == "" {
		return nil, twirp.RequiredArgumentError("application_id")
	}

	var item *storedItem
	err := s.db.View(func(txn *badger.Txn) error {
		entry, err := txn.Get(storageKey(req.ApplicationId, req.Key))
		if err == badger.ErrKeyNotFound {
			return nil
		}
		if err != nil {
			return err
		}
		return entry.Value(func(val []byte) error {
			var decoded storedItem
			if err := json.Unmarshal(val, &decoded); err != nil {
				return err
			}
			item = &decoded
			return nil
		})
	})
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("get storage item: %w", err))
	}
	if item == nil || isExpired(item.ExpiresAt) {
		return &client.GetResponse{}, nil
	}

	return &client.GetResponse{
		Item: &client.StorageItem{
			Key:               req.Key,
			Value:             item.Value,
			CreatedAt:         item.CreatedAt,
			ExpiresAt:         item.ExpiresAt,
			Namespace:         item.Namespace,
			ApplicationId:     req.ApplicationId,
			ClearOnSessionEnd: item.ClearOnSessionEnd,
		},
	}, nil
}

func (s *storageService) Set(ctx context.Context, req *client.SetRequest) (*client.SetResponse, error) {
	if req.Item == nil {
		return nil, twirp.RequiredArgumentError("item")
	}
	if strings.TrimSpace(req.Item.Key) == "" {
		return nil, twirp.RequiredArgumentError("item.key")
	}
	if strings.TrimSpace(req.Item.ApplicationId) == "" {
		return nil, twirp.RequiredArgumentError("item.application_id")
	}

	// created_at is server-authoritative — callers (the sandbox `ctx.storage`
	// binding) have no way to set it meaningfully today.
	encoded, err := json.Marshal(storedItem{
		Value:             req.Item.Value,
		CreatedAt:         time.Now().Unix(),
		ExpiresAt:         req.Item.ExpiresAt,
		Namespace:         req.Item.Namespace,
		ClearOnSessionEnd: req.Item.ClearOnSessionEnd,
	})
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("encode storage item: %w", err))
	}

	err = s.db.Update(func(txn *badger.Txn) error {
		return txn.Set(storageKey(req.Item.ApplicationId, req.Item.Key), encoded)
	})
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("set storage item: %w", err))
	}
	return &client.SetResponse{}, nil
}

func (s *storageService) Delete(ctx context.Context, req *client.DeleteRequest) (*client.DeleteResponse, error) {
	if strings.TrimSpace(req.Key) == "" {
		return nil, twirp.RequiredArgumentError("key")
	}
	if strings.TrimSpace(req.ApplicationId) == "" {
		return nil, twirp.RequiredArgumentError("application_id")
	}

	err := s.db.Update(func(txn *badger.Txn) error {
		err := txn.Delete(storageKey(req.ApplicationId, req.Key))
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

// deleteWhere scans every key under the application's prefix, deletes the ones
// `shouldDelete` accepts, and reports how many went. Shared by ClearNamespace /
// ClearExpired / ClearAllForApplication / ClearSessionScoped — none of these
// are hot-path operations, so a full per-application scan (rather than a
// secondary index) keeps this simple.
func (s *storageService) deleteWhere(applicationID string, shouldDelete func(item storedItem) bool) (int, error) {
	deleted := 0
	err := s.db.Update(func(txn *badger.Txn) error {
		prefix := []byte(applicationID + "\x00")
		opts := badger.DefaultIteratorOptions
		opts.Prefix = prefix
		it := txn.NewIterator(opts)
		defer it.Close()

		var keysToDelete [][]byte
		for it.Seek(prefix); it.ValidForPrefix(prefix); it.Next() {
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
		}
		deleted = len(keysToDelete)
		return nil
	})
	if err != nil {
		return 0, err
	}
	return deleted, nil
}

func (s *storageService) ClearNamespace(ctx context.Context, req *client.ClearNamespaceRequest) (*client.ClearNamespaceResponse, error) {
	if strings.TrimSpace(req.ApplicationId) == "" {
		return nil, twirp.RequiredArgumentError("application_id")
	}
	_, err := s.deleteWhere(req.ApplicationId, func(item storedItem) bool {
		return item.Namespace == req.Namespace
	})
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("clear namespace: %w", err))
	}
	return &client.ClearNamespaceResponse{}, nil
}

func (s *storageService) ClearExpired(ctx context.Context, req *client.ClearExpiredRequest) (*client.ClearExpiredResponse, error) {
	if strings.TrimSpace(req.ApplicationId) == "" {
		return nil, twirp.RequiredArgumentError("application_id")
	}
	_, err := s.deleteWhere(req.ApplicationId, func(item storedItem) bool {
		return isExpired(item.ExpiresAt)
	})
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("clear expired: %w", err))
	}
	return &client.ClearExpiredResponse{}, nil
}

func (s *storageService) ClearAllForApplication(ctx context.Context, req *client.ClearAllForApplicationRequest) (*client.ClearAllForApplicationResponse, error) {
	if strings.TrimSpace(req.ApplicationId) == "" {
		return nil, twirp.RequiredArgumentError("application_id")
	}
	_, err := s.deleteWhere(req.ApplicationId, func(storedItem) bool {
		return true
	})
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("clear all for application: %w", err))
	}
	return &client.ClearAllForApplicationResponse{}, nil
}

// ClearSessionScoped drops every key the application flagged
// `clear_on_session_end`. Called by the engine when a stream session ends.
//
// Clearing is the engine's job rather than a module's: the sandbox exposes only
// `get` and `set`, so a module declares that a key is session-scoped and the
// engine acts on the declaration.
func (s *storageService) ClearSessionScoped(ctx context.Context, req *client.ClearSessionScopedRequest) (*client.ClearSessionScopedResponse, error) {
	if strings.TrimSpace(req.ApplicationId) == "" {
		return nil, twirp.RequiredArgumentError("application_id")
	}
	cleared, err := s.deleteWhere(req.ApplicationId, func(item storedItem) bool {
		return item.ClearOnSessionEnd
	})
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("clear session scoped: %w", err))
	}
	return &client.ClearSessionScopedResponse{Cleared: int32(cleared)}, nil
}
