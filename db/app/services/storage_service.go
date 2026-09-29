package services

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
)

// StorageService backs `ctx.storage` for sandboxed module functions (see
// barkloader's CtxStorage / storage.proto). A value is addressed by namespace
// and key: the namespace -- the owning module's manifest id -- keeps modules
// apart, so two modules using the same key never read each other's values.
//
// Values live in the module_storage table of their own SQLite file (see
// EnsureStorageSchema). Every operation is a single statement, so each is
// atomic without an explicit transaction.
type storageService struct {
	db *sql.DB
}

func NewStorageService(db *sql.DB) *storageService {
	return &storageService{db: db}
}

// storedItem is one module_storage row minus its address.
type storedItem struct {
	Value             string
	CreatedAt         int64
	ExpiresAt         int64
	ClearOnSessionEnd bool
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
// means "never expires" (proto contract). Must agree with liveCondition.
func isExpired(expiresAt int64, now int64) bool {
	return expiresAt != 0 && expiresAt <= now
}

// liveCondition is isExpired, negated, for a WHERE clause; its one parameter
// is the current unix time.
const liveCondition = `(expires_at = 0 OR expires_at > ?)`

const itemColumns = `value, created_at, expires_at, clear_on_session_end`

func scanItem(row *sql.Row) (*storedItem, error) {
	var item storedItem
	err := row.Scan(&item.Value, &item.CreatedAt, &item.ExpiresAt, &item.ClearOnSessionEnd)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &item, nil
}

// readItem returns the live item at an address, or nil when there is none or
// it has expired.
func (s *storageService) readItem(ctx context.Context, namespace, key string, now int64) (*storedItem, error) {
	return scanItem(s.db.QueryRowContext(ctx,
		`SELECT `+itemColumns+` FROM module_storage WHERE namespace = ? AND key = ? AND `+liveCondition,
		namespace, key, now,
	))
}

func (s *storageService) Get(ctx context.Context, req *client.GetRequest) (*client.GetResponse, error) {
	if err := requireAddress(req.Namespace, req.Key, ""); err != nil {
		return nil, err
	}

	item, err := s.readItem(ctx, req.Namespace, req.Key, time.Now().Unix())
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("get storage item: %w", err))
	}
	if item == nil {
		return &client.GetResponse{}, nil
	}
	return &client.GetResponse{Item: toStorageItem(req.Namespace, req.Key, item)}, nil
}

// upsertColumns and upsertAssignments write every stored field of an item;
// the values are bound by upsertArgs, in this order.
const (
	upsertColumns     = `(namespace, key, value, created_at, expires_at, clear_on_session_end)`
	upsertPlaceholder = `(?, ?, ?, ?, ?, ?)`
	upsertAssignments = `value = excluded.value, created_at = excluded.created_at, ` +
		`expires_at = excluded.expires_at, clear_on_session_end = excluded.clear_on_session_end`
)

// upsertArgs binds an item for a write. created_at is server-authoritative:
// callers (the sandbox `ctx.storage` binding) have no way to set it
// meaningfully.
func upsertArgs(item *client.StorageItem, now int64) []any {
	return []any{item.Namespace, item.Key, item.Value, now, item.ExpiresAt, item.ClearOnSessionEnd}
}

func (s *storageService) Set(ctx context.Context, req *client.SetRequest) (*client.SetResponse, error) {
	if req.Item == nil {
		return nil, twirp.RequiredArgumentError("item")
	}
	if err := requireAddress(req.Item.Namespace, req.Item.Key, "item."); err != nil {
		return nil, err
	}

	_, err := s.db.ExecContext(ctx,
		`INSERT INTO module_storage `+upsertColumns+` VALUES `+upsertPlaceholder+
			` ON CONFLICT (namespace, key) DO UPDATE SET `+upsertAssignments,
		upsertArgs(req.Item, time.Now().Unix())...,
	)
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("set storage item: %w", err))
	}
	return &client.SetResponse{}, nil
}

// CompareAndSet writes only if the key holds what the caller expects, in one
// statement.
//
// Expect-value is an UPDATE guarded by the expected value and liveness;
// expect-absent is an INSERT whose conflict branch overwrites only an expired
// row, since an expired item counts as absent. Either way SQLite returns the
// written row, or nothing when the guard refused. A refusal reads the value
// now stored, which is what the caller retries from.
func (s *storageService) CompareAndSet(ctx context.Context, req *client.CompareAndSetRequest) (*client.CompareAndSetResponse, error) {
	if req.Item == nil {
		return nil, twirp.RequiredArgumentError("item")
	}
	if err := requireAddress(req.Item.Namespace, req.Item.Key, "item."); err != nil {
		return nil, err
	}
	item := req.Item
	now := time.Now().Unix()

	var row *sql.Row
	if req.ExpectAbsent {
		row = s.db.QueryRowContext(ctx,
			`INSERT INTO module_storage `+upsertColumns+` VALUES `+upsertPlaceholder+
				` ON CONFLICT (namespace, key) DO UPDATE SET `+upsertAssignments+
				` WHERE module_storage.expires_at <> 0 AND module_storage.expires_at <= ?`+
				` RETURNING `+itemColumns,
			append(upsertArgs(item, now), now)...,
		)
	} else {
		row = s.db.QueryRowContext(ctx,
			`UPDATE module_storage SET value = ?, created_at = ?, expires_at = ?, clear_on_session_end = ?`+
				` WHERE namespace = ? AND key = ? AND value = ? AND `+liveCondition+
				` RETURNING `+itemColumns,
			item.Value, now, item.ExpiresAt, item.ClearOnSessionEnd,
			item.Namespace, item.Key, req.ExpectedValue, now,
		)
	}

	written, err := scanItem(row)
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("compare and set storage item: %w", err))
	}
	if written != nil {
		return &client.CompareAndSetResponse{Swapped: true, Current: toStorageItem(item.Namespace, item.Key, written)}, nil
	}

	current, err := s.readItem(ctx, item.Namespace, item.Key, now)
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("compare and set storage item: %w", err))
	}
	response := &client.CompareAndSetResponse{Swapped: false}
	if current != nil {
		response.Current = toStorageItem(item.Namespace, item.Key, current)
	}
	return response, nil
}

func (s *storageService) Delete(ctx context.Context, req *client.DeleteRequest) (*client.DeleteResponse, error) {
	if err := requireAddress(req.Namespace, req.Key, ""); err != nil {
		return nil, err
	}

	if _, err := s.db.ExecContext(ctx,
		`DELETE FROM module_storage WHERE namespace = ? AND key = ?`, req.Namespace, req.Key,
	); err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("delete storage item: %w", err))
	}
	return &client.DeleteResponse{}, nil
}

func (s *storageService) ClearNamespace(ctx context.Context, req *client.ClearNamespaceRequest) (*client.ClearNamespaceResponse, error) {
	if strings.TrimSpace(req.Namespace) == "" {
		return nil, twirp.RequiredArgumentError("namespace")
	}
	if _, err := s.db.ExecContext(ctx, `DELETE FROM module_storage WHERE namespace = ?`, req.Namespace); err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("clear namespace: %w", err))
	}
	return &client.ClearNamespaceResponse{}, nil
}

func (s *storageService) ClearExpired(ctx context.Context, req *client.ClearExpiredRequest) (*client.ClearExpiredResponse, error) {
	if _, err := s.db.ExecContext(ctx,
		`DELETE FROM module_storage WHERE expires_at <> 0 AND expires_at <= ?`, time.Now().Unix(),
	); err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("clear expired: %w", err))
	}
	return &client.ClearExpiredResponse{}, nil
}

// ClearSessionScoped drops every key flagged `clear_on_session_end`, expired
// or not, and reports each one it dropped. Called by the engine when a stream
// session ends; the engine announces each cleared key as changed.
//
// Clearing is the engine's job rather than a module's: the sandbox exposes only
// `get` and `set`, so a module declares that a key is session-scoped and the
// engine acts on the declaration.
func (s *storageService) ClearSessionScoped(ctx context.Context, req *client.ClearSessionScopedRequest) (*client.ClearSessionScopedResponse, error) {
	rows, err := s.db.QueryContext(ctx, `DELETE FROM module_storage WHERE clear_on_session_end = 1 RETURNING namespace, key`)
	if err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("clear session scoped: %w", err))
	}
	defer rows.Close()

	var cleared []*client.StorageItem
	for rows.Next() {
		var item client.StorageItem
		if err := rows.Scan(&item.Namespace, &item.Key); err != nil {
			return nil, twirp.InternalErrorWith(fmt.Errorf("clear session scoped: %w", err))
		}
		cleared = append(cleared, &item)
	}
	if err := rows.Err(); err != nil {
		return nil, twirp.InternalErrorWith(fmt.Errorf("clear session scoped: %w", err))
	}
	return &client.ClearSessionScopedResponse{Cleared: int32(len(cleared)), ClearedItems: cleared}, nil
}
