package services

// import (
// 	"context"
// 	"encoding/json"
// 	"fmt"
// 	"time"

// 	"github.com/dgraph-io/badger/v3"
// 	"github.com/google/uuid"
// 	"google.golang.org/grpc/codes"
// 	"google.golang.org/grpc/status"

// 	rpc "github.com/wolfymaster/woofx3/buf"
// )

// type StorageService struct {
// 	db *badger.DB
// }

// // NewStorageService creates a new StorageService instance
// func NewStorageService(badgerDB *badger.DB) (*StorageService, error) {
// 	if badgerDB == nil {
// 		return nil, fmt.Errorf("badgerDB cannot be nil")
// 	}

// 	return &StorageService{db: badgerDB}, nil
// }

// Close closes the database connection
// func (s *StorageService) Close() error {
// 	return s.db.Close()
// }

// // StorageItem represents a value stored in the key-value store
// type StorageItem struct {
//     Value             string    `json:"value"`
//     CreatedAt         time.Time `json:"created_at"`
//     ExpiresAt         time.Time `json:"expires_at,omitempty"`
//     Namespace         string    `json:"namespace"`
//     ClearOnStreamEnd  bool      `json:"clear_on_stream_end"`
//     ClearOnSessionEnd bool      `json:"clear_on_session_end"`
// }

// // Set stores a value with the given key and options
// func (s *StorageService) Set(ctx context.Context, applicationID uuid.UUID, key string, value string) error {
//     item := &StorageItem{
//         Value:     value,
//         CreatedAt: time.Now(),
//         Namespace: "default",
//     }

//     data, err := json.Marshal(item)
//     if err != nil {
//         return fmt.Errorf("failed to marshal storage item: %w", err)
//     }

//     return s.db.Update(func(txn *badger.Txn) error {
//         return txn.Set(s.generateKey(applicationID, key), data)
//     })
// }

// // Get retrieves a value by key
// func (s *StorageService) Get(ctx context.Context, applicationID uuid.UUID, key string) (string, *StorageItem, error) {
//     var item StorageItem
//     var data []byte

//     err := s.db.View(func(txn *badger.Txn) error {
//         item, err := txn.Get(s.generateKey(applicationID, key))
//         if err != nil {
//             return err
//         }
//         return item.Value(func(val []byte) error {
//             data = make([]byte, len(val))
//             copy(data, val)
//             return nil
//         })
//     })

//     if err != nil {
//         return "", nil, fmt.Errorf("failed to get key: %w", err)
//     }

//     if err := json.Unmarshal(data, &item); err != nil {
//         return "", nil, fmt.Errorf("failed to unmarshal storage item: %w", err)
//     }

//     return item.Value, &item, nil
// }

// // Delete removes a key from the store
// func (s *StorageService) Delete(ctx context.Context, applicationID uuid.UUID, key string) error {
//     return s.db.Update(func(txn *badger.Txn) error {
//         return txn.Delete(s.generateKey(applicationID, key))
//     })
// }

// // ClearNamespace removes all keys in a namespace
// func (s *StorageService) ClearNamespace(ctx context.Context, applicationID uuid.UUID, namespace string) error {
//     prefix := s.generateKey(applicationID, namespace)

//     return s.db.Update(func(txn *badger.Txn) error {
//         it := txn.NewIterator(badger.DefaultIteratorOptions)
//         defer it.Close()

//         for it.Seek(prefix); it.ValidForPrefix(prefix); it.Next() {
//             item := it.Item()
//             if err := txn.Delete(item.KeyCopy(nil)); err != nil {
//                 return err
//             }
//         }
//         return nil
//     })
// }

// // ClearExpired removes all expired keys
// func (s *StorageService) ClearExpired(ctx context.Context) error {
//     return s.db.Update(func(txn *badger.Txn) error {
//         it := txn.NewIterator(badger.DefaultIteratorOptions)
//         defer it.Close()

//         now := time.Now()
//         var keysToDelete [][]byte

//         // First pass: collect expired keys
//         for it.Rewind(); it.Valid(); it.Next() {
//             item := it.Item()
//             var storageItem StorageItem

//             err := item.Value(func(val []byte) error {
//                 return json.Unmarshal(val, &storageItem)
//             })

//             if err == nil && !storageItem.ExpiresAt.IsZero() && now.After(storageItem.ExpiresAt) {
//                 key := make([]byte, len(item.Key()))
//                 copy(key, item.Key())
//                 keysToDelete = append(keysToDelete, key)
//             }
//         }

//         // Second pass: delete expired keys
//         for _, key := range keysToDelete {
//             if err := txn.Delete(key); err != nil {
//                 return err
//             }
//         }

//         return nil
//     })
// }

// // generateKey creates a namespaced key for storage
// func (s *StorageService) generateKey(applicationID uuid.UUID, key string) []byte {
//     return []byte(fmt.Sprintf("%s:%s", applicationID.String(), key))
// }

// // ListKeys returns all keys for an application, optionally filtered by namespace
// func (s *StorageService) ListKeys(ctx context.Context, applicationID uuid.UUID, namespace string) ([]string, error) {
//     var keys []string
//     prefix := s.generateKey(applicationID, namespace)

//     err := s.db.View(func(txn *badger.Txn) error {
//         it := txn.NewIterator(badger.DefaultIteratorOptions)
//         defer it.Close()

//         for it.Seek(prefix); it.ValidForPrefix(prefix); it.Next() {
//             item := it.Item()
//             key := string(item.Key())
//             keys = append(keys, key)
//         }
//         return nil
//     })

//     if err != nil {
//         return nil, fmt.Errorf("failed to list keys: %w", err)
//     }

//     return keys, nil
// }

// // ClearAllForApplication clears all keys for a specific application
// func (s *StorageService) ClearAllForApplication(ctx context.Context, req *rpc.ClearAllForApplicationRequest) (*rpc.ClearAllForApplicationResponse, error) {
// 	if req == nil {
// 		return nil, status.Error(codes.InvalidArgument, "request cannot be nil")
// 	}

// 	appID, err := uuid.Parse(req.ApplicationId)
// 	if err != nil {
// 		return nil, status.Errorf(codes.InvalidArgument, "invalid application_id: %v", err)
// 	}

// 	// Get all keys for the application
// 	keys, err := s.ListKeys(ctx, appID, "")
// 	if err != nil {
// 		return nil, status.Errorf(codes.Internal, "failed to list keys: %v", err)
// 	}

// 	// Delete all keys in a single transaction
// 	err = s.db.Update(func(txn *badger.Txn) error {
// 		for _, key := range keys {
// 			fullKey := s.generateKey(appID, key)
// 			if err := txn.Delete(fullKey); err != nil {
// 				return fmt.Errorf("failed to delete key %s: %w", key, err)
// 			}
// 		}
// 		return nil
// 	})

// 	if err != nil {
// 		return nil, status.Errorf(codes.Internal, "failed to clear keys: %v", err)
// 	}

// 	return &rpc.ClearAllForApplicationResponse{
// 		KeysDeleted: int32(len(keys)),
// 	}, nil
// }
