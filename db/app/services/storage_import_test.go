package services

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/dgraph-io/badger/v3"
)

// writeBadgerStore creates an on-disk Badger store at dir holding items, as
// the Badger-backed storage service laid them out, and closes it.
func writeBadgerStore(t *testing.T, dir string, write func(db *badger.DB)) {
	t.Helper()
	db, err := badger.Open(badger.DefaultOptions(dir).WithLoggingLevel(badger.ERROR))
	if err != nil {
		t.Fatalf("open badger: %v", err)
	}
	write(db)
	if err := db.Close(); err != nil {
		t.Fatalf("close badger: %v", err)
	}
}

func putBadgerItem(t *testing.T, db *badger.DB, namespace, key string, item badgerItem) {
	t.Helper()
	item.Namespace = namespace
	encoded, err := json.Marshal(item)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	if err := db.Update(func(txn *badger.Txn) error { return txn.Set(storageKey(namespace, key), encoded) }); err != nil {
		t.Fatalf("put %s/%s: %v", namespace, key, err)
	}
}

func TestImportBadgerStorage(t *testing.T) {
	ctx := context.Background()
	now := time.Now()
	future := now.Add(time.Hour).Unix()
	past := now.Add(-time.Hour).Unix()

	dir := filepath.Join(t.TempDir(), "badger")
	writeBadgerStore(t, dir, func(db *badger.DB) {
		putBadgerItem(t, db, "woofx3", "count", badgerItem{Value: "7", CreatedAt: 100})
		putBadgerItem(t, db, "woofx3", "timer", badgerItem{Value: "t", CreatedAt: 101, ExpiresAt: future, ClearOnSessionEnd: true})
		putBadgerItem(t, db, "woofx3", "gone", badgerItem{Value: "old", CreatedAt: 102, ExpiresAt: past})
		putBadgerItem(t, db, "other", "kept", badgerItem{Value: "from badger", CreatedAt: 103})
		putLegacy(t, db, appA, "legacy_mod", "state", "from legacy", 104)
	})

	storage := openStorageTestFile(t)
	svc := NewStorageService(storage)
	mustSet(t, svc, storageItem("other", "kept", "already in sqlite"))

	result, err := ImportBadgerStorage(ctx, storage, dir, now)
	if err != nil {
		t.Fatalf("ImportBadgerStorage: %v", err)
	}
	if result.Imported != 3 || result.Skipped != 2 {
		t.Errorf("imported %d, skipped %d; want 3 imported, 2 skipped (one expired, one already stored)", result.Imported, result.Skipped)
	}

	count := mustGet(t, svc, "woofx3", "count")
	if count == nil || count.Value != "7" || count.CreatedAt != 100 {
		t.Errorf("woofx3/count = %+v, want value 7 with its original created_at", count)
	}
	timer := mustGet(t, svc, "woofx3", "timer")
	if timer == nil || timer.ExpiresAt != future || !timer.ClearOnSessionEnd {
		t.Errorf("woofx3/timer = %+v, want its expiry and session flag kept", timer)
	}
	if kept := mustGet(t, svc, "other", "kept"); kept.GetValue() != "already in sqlite" {
		t.Errorf("other/kept = %q, want the row SQLite already held", kept.GetValue())
	}
	if legacy := mustGet(t, svc, "legacy_mod", "state"); legacy.GetValue() != "from legacy" {
		t.Errorf("legacy_mod/state = %+v, want the value from the application-scoped layout", legacy)
	}

	// Not merely unreadable: the expired item is not carried over at all.
	var rows int
	if err := storage.QueryRow(`SELECT count(*) FROM module_storage WHERE namespace = 'woofx3' AND key = 'gone'`).Scan(&rows); err != nil {
		t.Fatalf("count: %v", err)
	}
	if rows != 0 {
		t.Error("the expired item was imported")
	}

	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Errorf("badger directory still at %s after import (stat: %v)", dir, err)
	}
	if _, err := os.Stat(filepath.Join(result.ArchivedTo, badgerManifest)); err != nil {
		t.Errorf("archived store not at %s: %v", result.ArchivedTo, err)
	}

	t.Run("a second start finds nothing to import", func(t *testing.T) {
		mustSet(t, svc, storageItem("woofx3", "count", "8"))

		again, err := ImportBadgerStorage(ctx, storage, dir, now.Add(time.Minute))
		if err != nil {
			t.Fatalf("ImportBadgerStorage: %v", err)
		}
		if again != (BadgerImportResult{}) {
			t.Errorf("second import = %+v, want nothing done", again)
		}
		if count := mustGet(t, svc, "woofx3", "count"); count.GetValue() != "8" {
			t.Errorf("woofx3/count = %q after a second start, want the newer 8", count.GetValue())
		}
	})
}

func TestImportBadgerStorage_NothingToImport(t *testing.T) {
	ctx := context.Background()
	storage := openStorageTestFile(t)

	cases := map[string]string{
		"no path configured": "",
		"missing directory":  filepath.Join(t.TempDir(), "never-created"),
	}
	// A directory that is not a Badger store (an empty data directory, say)
	// must be left alone rather than opened, which would make it one.
	plain := filepath.Join(t.TempDir(), "plain")
	if err := os.MkdirAll(plain, 0o750); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	cases["not a badger store"] = plain

	for name, path := range cases {
		t.Run(name, func(t *testing.T) {
			result, err := ImportBadgerStorage(ctx, storage, path, time.Now())
			if err != nil {
				t.Fatalf("ImportBadgerStorage: %v", err)
			}
			if result != (BadgerImportResult{}) {
				t.Errorf("result = %+v, want nothing done", result)
			}
		})
	}

	entries, err := os.ReadDir(plain)
	if err != nil {
		t.Fatalf("read plain dir: %v", err)
	}
	if len(entries) != 0 {
		t.Errorf("import wrote %d files into a directory that was not a Badger store", len(entries))
	}
}
