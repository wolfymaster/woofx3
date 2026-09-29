package replication

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func openTest(t *testing.T, path, replicaURL string) *Store {
	t.Helper()
	store, err := Open(context.Background(), Config{Path: path, ReplicaURL: replicaURL, Logger: testLogger()})
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	return store
}

func closeTest(t *testing.T, store *Store) {
	t.Helper()
	if err := store.Close(context.Background()); err != nil {
		t.Fatalf("Close: %v", err)
	}
}

func createTable(t *testing.T, store *Store) {
	t.Helper()
	if _, err := store.DB().Exec(`CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)`); err != nil {
		t.Fatalf("create table: %v", err)
	}
}

func put(t *testing.T, store *Store, key, value string) {
	t.Helper()
	if _, err := store.DB().Exec(
		`INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v`, key, value,
	); err != nil {
		t.Fatalf("put %s: %v", key, err)
	}
}

func get(t *testing.T, store *Store, key string) string {
	t.Helper()
	var value string
	if err := store.DB().QueryRow(`SELECT v FROM kv WHERE k = ?`, key).Scan(&value); err != nil {
		t.Fatalf("get %s: %v", key, err)
	}
	return value
}

func pragma(t *testing.T, store *Store, name string) string {
	t.Helper()
	var value string
	if err := store.DB().QueryRow(`PRAGMA ` + name).Scan(&value); err != nil {
		t.Fatalf("PRAGMA %s: %v", name, err)
	}
	return value
}

func fileReplicaURL(dir string) string {
	return "file://" + filepath.ToSlash(dir)
}

func TestOpen_RequiresPathAndLogger(t *testing.T) {
	if _, err := Open(context.Background(), Config{Logger: testLogger()}); err == nil {
		t.Error("Open accepted an empty path")
	}
	if _, err := Open(context.Background(), Config{Path: filepath.Join(t.TempDir(), "x.db")}); err == nil {
		t.Error("Open accepted a nil logger")
	}
}

func TestLocal_DataSurvivesReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "storage.db")

	store := openTest(t, path, "")
	if store.Replicated() {
		t.Fatal("a store with no replica URL reports replicated")
	}
	createTable(t, store)
	put(t, store, "a", "1")
	closeTest(t, store)

	reopened := openTest(t, path, "")
	defer closeTest(t, reopened)
	if got := get(t, reopened, "a"); got != "1" {
		t.Errorf("after reopen a = %q, want 1", got)
	}
}

// Every pooled connection must carry the pragmas, not just the first one.
func TestLocal_PragmasOnEveryConnection(t *testing.T) {
	store := openTest(t, filepath.Join(t.TempDir(), "storage.db"), "")
	defer closeTest(t, store)
	store.DB().SetMaxIdleConns(4)

	ctx := context.Background()
	for i := range 4 {
		conn, err := store.DB().Conn(ctx)
		if err != nil {
			t.Fatalf("conn %d: %v", i, err)
		}
		defer conn.Close()
		checks := map[string]string{"journal_mode": "wal", "synchronous": "2", "busy_timeout": "5000", "wal_autocheckpoint": "1000"}
		for name, want := range checks {
			var got string
			if err := conn.QueryRowContext(ctx, `PRAGMA `+name).Scan(&got); err != nil {
				t.Fatalf("conn %d PRAGMA %s: %v", i, name, err)
			}
			if got != want {
				t.Errorf("conn %d %s = %s, want %s", i, name, got, want)
			}
		}
	}
}

// With no Litestream to checkpoint, SQLite's own automatic checkpoint must
// keep the WAL from growing with every write.
func TestLocal_WALStaysBounded(t *testing.T) {
	path := filepath.Join(t.TempDir(), "storage.db")
	store := openTest(t, path, "")
	defer closeTest(t, store)
	createTable(t, store)

	value := strings.Repeat("x", 1024)
	for i := range 6000 {
		put(t, store, fmt.Sprintf("key-%d", i%500), fmt.Sprintf("%d%s", i, value))
	}

	info, err := os.Stat(path + "-wal")
	if err != nil {
		t.Fatalf("stat wal: %v", err)
	}
	// 6000 upserts of page-sized values would leave tens of MB of WAL if nothing
	// checkpointed;
	// the autocheckpoint threshold (1000 pages) keeps it near 4 MB.
	const bound = 16 << 20
	if info.Size() > bound {
		t.Errorf("wal is %d bytes after sustained writes, want at most %d", info.Size(), bound)
	}
}

func TestReplicated_TurnsOffAutocheckpoint(t *testing.T) {
	dir := t.TempDir()
	store := openTest(t, filepath.Join(dir, "data", "storage.db"), fileReplicaURL(filepath.Join(dir, "replica")))
	defer closeTest(t, store)

	if !store.Replicated() {
		t.Fatal("a store with a replica URL reports not replicated")
	}
	if got := pragma(t, store, "wal_autocheckpoint"); got != "0" {
		t.Errorf("wal_autocheckpoint = %s, want 0: Litestream must own checkpoints", got)
	}
	if got := pragma(t, store, "journal_mode"); got != "wal" {
		t.Errorf("journal_mode = %s, want wal", got)
	}
}

// A new host has no local file: it must come back from the replica with every
// write the old host committed before a graceful shutdown, with no wait for
// the background sync.
func TestReplicated_GracefulCloseFlushesAndMissingFileRestores(t *testing.T) {
	dir := t.TempDir()
	replica := fileReplicaURL(filepath.Join(dir, "replica"))

	first := openTest(t, filepath.Join(dir, "host-a", "storage.db"), replica)
	createTable(t, first)
	for i := range 50 {
		put(t, first, fmt.Sprintf("k%d", i), fmt.Sprintf("v%d", i))
	}
	put(t, first, "last", "written just before shutdown")
	closeTest(t, first)

	restored := openTest(t, filepath.Join(dir, "host-b", "storage.db"), replica)
	defer closeTest(t, restored)
	if got := get(t, restored, "last"); got != "written just before shutdown" {
		t.Errorf("last = %q after restore, want the final write", got)
	}
	if got := get(t, restored, "k49"); got != "v49" {
		t.Errorf("k49 = %q after restore, want v49", got)
	}

	// The restored host keeps replicating to the same place.
	put(t, restored, "after-restore", "yes")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := restored.Sync(ctx); err != nil {
		t.Fatalf("Sync: %v", err)
	}
	inSync, err := restored.InSync(ctx)
	if err != nil {
		t.Fatalf("InSync: %v", err)
	}
	if !inSync {
		t.Error("replica is behind after Sync")
	}
}

func TestReplicated_ExistingFileIsNotOverwritten(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "data", "storage.db")
	replica := fileReplicaURL(filepath.Join(dir, "replica"))

	store := openTest(t, path, replica)
	createTable(t, store)
	put(t, store, "a", "1")
	closeTest(t, store)

	reopened := openTest(t, path, replica)
	defer closeTest(t, reopened)
	put(t, reopened, "b", "2")
	if got := get(t, reopened, "a"); got != "1" {
		t.Errorf("a = %q after reopen, want 1", got)
	}
}

func TestReplicated_EmptyReplicaStartsFresh(t *testing.T) {
	dir := t.TempDir()
	store := openTest(t, filepath.Join(dir, "data", "storage.db"), fileReplicaURL(filepath.Join(dir, "replica")))
	defer closeTest(t, store)
	createTable(t, store)
	put(t, store, "a", "1")
}

// A replica that cannot be read must stop the open: serving an empty store in
// place of the real one would silently lose every module's state.
func TestReplicated_FailedRestoreFailsOpen(t *testing.T) {
	dir := t.TempDir()
	unreadable := filepath.Join(dir, "replica")
	if err := os.WriteFile(unreadable, []byte("not a replica directory"), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	path := filepath.Join(dir, "data", "storage.db")

	store, err := Open(context.Background(), Config{Path: path, ReplicaURL: fileReplicaURL(unreadable), Logger: testLogger()})
	if err == nil {
		_ = store.Close(context.Background())
		t.Fatal("Open succeeded over an unreadable replica")
	}
	if !strings.Contains(err.Error(), "restore") {
		t.Errorf("error = %v, want it to come from the restore", err)
	}
	if _, statErr := os.Stat(path); !os.IsNotExist(statErr) {
		t.Errorf("a failed restore left a database file behind (stat: %v)", statErr)
	}
}

func TestReplicated_RejectsUnknownScheme(t *testing.T) {
	_, err := Open(context.Background(), Config{
		Path:       filepath.Join(t.TempDir(), "storage.db"),
		ReplicaURL: "gopher://nowhere/storage",
		Logger:     testLogger(),
	})
	if err == nil {
		t.Fatal("Open accepted a replica scheme with no client")
	}
}

func TestRedactURL(t *testing.T) {
	got := redactURL("s3://key:secret@bucket/engines/e1?endpoint=https://minio.local&token=abc")
	if strings.Contains(got, "secret") || strings.Contains(got, "token") || strings.Contains(got, "key:") {
		t.Errorf("redactURL leaked credentials: %s", got)
	}
	if got != "s3://bucket/engines/e1" {
		t.Errorf("redactURL = %s, want s3://bucket/engines/e1", got)
	}
}
