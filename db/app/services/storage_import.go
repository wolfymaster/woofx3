package services

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/dgraph-io/badger/v3"
)

// Module storage used to live in Badger. This file reads that layout once, to
// carry existing values into module_storage; nothing writes it any more.

// badgerItem is the JSON envelope a Badger value holds.
type badgerItem struct {
	Value             string `json:"value"`
	CreatedAt         int64  `json:"createdAt"`
	ExpiresAt         int64  `json:"expiresAt"`
	Namespace         string `json:"namespace"`
	ClearOnSessionEnd bool   `json:"clearOnSessionEnd"`
}

// storageKey is a Badger key: "<namespace>\x00<key>".
func storageKey(namespace, key string) []byte {
	return []byte(namespace + "\x00" + key)
}

// splitStorageKey recovers the namespace and key from a Badger key.
func splitStorageKey(raw []byte) (namespace, key string, ok bool) {
	parts := strings.SplitN(string(raw), "\x00", 2)
	if len(parts) != 2 {
		return "", "", false
	}
	return parts[0], parts[1], true
}

// badgerManifest is the file every Badger directory holds; its absence means
// the directory is not a Badger store (an empty data directory, say).
const badgerManifest = "MANIFEST"

// BadgerImportResult says what ImportBadgerStorage did.
type BadgerImportResult struct {
	// Imported is the number of rows written to module_storage.
	Imported int
	// Skipped counts items left behind: expired ones, and ones whose address
	// module_storage already held.
	Skipped int
	// ArchivedTo is where the Badger directory was moved; empty when there
	// was nothing to import.
	ArchivedTo string
}

// ImportBadgerStorage copies every live item of the Badger store at
// badgerPath into module_storage, then renames the directory to
// "<badgerPath>.imported-<UTC timestamp>" so the next start finds nothing to
// import. A missing directory, or one that is not a Badger store, is not an
// error: there is nothing to import.
//
// Rows module_storage already holds win over Badger's: they were restored
// from the replica or written since, so they are newer. Expired items are
// dropped rather than copied, because they already read as absent.
func ImportBadgerStorage(ctx context.Context, db *sql.DB, badgerPath string, now time.Time) (BadgerImportResult, error) {
	if strings.TrimSpace(badgerPath) == "" {
		return BadgerImportResult{}, nil
	}
	if _, err := os.Stat(filepath.Join(badgerPath, badgerManifest)); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return BadgerImportResult{}, nil
		}
		return BadgerImportResult{}, fmt.Errorf("inspect badger directory: %w", err)
	}

	result, err := copyBadgerStorage(ctx, db, badgerPath, now.Unix())
	if err != nil {
		return BadgerImportResult{}, err
	}

	archive := fmt.Sprintf("%s.imported-%s", filepath.Clean(badgerPath), now.UTC().Format("20060102T150405Z"))
	if err := os.Rename(badgerPath, archive); err != nil {
		return BadgerImportResult{}, fmt.Errorf("archive imported badger directory: %w", err)
	}
	result.ArchivedTo = archive
	return result, nil
}

func copyBadgerStorage(ctx context.Context, db *sql.DB, badgerPath string, now int64) (BadgerImportResult, error) {
	// Opened read-write rather than read-only: Badger does not support
	// read-only mode on Windows, and legacy keys are rewritten in place first.
	store, err := badger.Open(badger.DefaultOptions(badgerPath).WithLoggingLevel(badger.WARNING))
	if err != nil {
		return BadgerImportResult{}, fmt.Errorf("open badger for import: %w", err)
	}
	defer store.Close()

	if _, err := MigrateStorageKeys(store); err != nil {
		return BadgerImportResult{}, err
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return BadgerImportResult{}, fmt.Errorf("begin badger import: %w", err)
	}
	defer tx.Rollback()

	insert, err := tx.PrepareContext(ctx,
		`INSERT INTO module_storage `+upsertColumns+` VALUES `+upsertPlaceholder+
			` ON CONFLICT (namespace, key) DO NOTHING`,
	)
	if err != nil {
		return BadgerImportResult{}, fmt.Errorf("prepare badger import: %w", err)
	}
	defer insert.Close()

	var result BadgerImportResult
	err = store.View(func(txn *badger.Txn) error {
		it := txn.NewIterator(badger.DefaultIteratorOptions)
		defer it.Close()
		for it.Rewind(); it.Valid(); it.Next() {
			entry := it.Item()
			namespace, key, ok := splitStorageKey(entry.Key())
			if !ok {
				return fmt.Errorf("badger key %q has no namespace", entry.Key())
			}
			var item badgerItem
			if err := entry.Value(func(val []byte) error {
				return json.Unmarshal(val, &item)
			}); err != nil {
				return fmt.Errorf("decode badger item %q: %w", entry.Key(), err)
			}
			if isExpired(item.ExpiresAt, now) {
				result.Skipped++
				continue
			}
			res, err := insert.ExecContext(ctx, namespace, key, item.Value, item.CreatedAt, item.ExpiresAt, item.ClearOnSessionEnd)
			if err != nil {
				return fmt.Errorf("import %s/%s: %w", namespace, key, err)
			}
			written, err := res.RowsAffected()
			if err != nil {
				return err
			}
			if written == 1 {
				result.Imported++
			} else {
				result.Skipped++
			}
		}
		return nil
	})
	if err != nil {
		return BadgerImportResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return BadgerImportResult{}, fmt.Errorf("commit badger import: %w", err)
	}
	return result, nil
}
