// Package replication opens an embedded SQLite database that is optionally
// streamed to S3-compatible object storage by Litestream.
//
// It is the only package that imports Litestream. The Litestream library API
// is documented as unstable, so the version is pinned in go.mod and every call
// into it stays here, where an upgrade has one place to change.
package replication

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/benbjohnson/litestream"
	_ "github.com/benbjohnson/litestream/file"
	"github.com/benbjohnson/litestream/s3"
	_ "modernc.org/sqlite"
)

// driverName is modernc.org/sqlite's registered name. Litestream reads the
// same file through the same driver; two SQLite builds in one process would
// hold separate POSIX locks on it and could not see each other's.
const driverName = "sqlite"

// shutdownSyncTimeout bounds the final flush to the replica on Close. It must
// stay below the time the process is given to exit after SIGTERM (see
// build/orchestrator), or the flush is cut off by SIGKILL.
const shutdownSyncTimeout = 10 * time.Second

// Config says where the database lives and whether it is replicated.
type Config struct {
	// Path is the SQLite file. Its directory is created when missing.
	Path string
	// ReplicaURL is a Litestream replica URL (s3://bucket/path?endpoint=...,
	// or file:///dir). Empty means local mode: plain SQLite, no replication.
	ReplicaURL string
	// AccessKeyID and SecretAccessKey are S3 credentials. When empty, the
	// replica client falls back to the standard AWS credential sources.
	AccessKeyID     string
	SecretAccessKey string
	Logger          *slog.Logger
}

// Store is an open database and, when replicated, the Litestream store
// streaming it.
type Store struct {
	db         *sql.DB
	litestream *litestream.Store
	replicaDB  *litestream.DB
}

// Open opens the database at cfg.Path.
//
// Local mode (no ReplicaURL): the file is opened as is, with SQLite's
// automatic checkpointing on, because nothing else would checkpoint the WAL.
//
// Replicated mode: when the file is missing it is first restored from the
// replica (a replica with no backup yet leaves a fresh database), Litestream
// starts streaming, and automatic checkpointing is off because Litestream
// must decide when the WAL is folded into the database. A failed restore is
// an error; the caller must not serve from an empty store in its place.
func Open(ctx context.Context, cfg Config) (*Store, error) {
	if strings.TrimSpace(cfg.Path) == "" {
		return nil, errors.New("replication: database path is required")
	}
	if cfg.Logger == nil {
		return nil, errors.New("replication: logger is required")
	}
	if err := os.MkdirAll(filepath.Dir(cfg.Path), 0o750); err != nil {
		return nil, fmt.Errorf("create database directory: %w", err)
	}

	if strings.TrimSpace(cfg.ReplicaURL) == "" {
		db, err := openPool(cfg.Path, false)
		if err != nil {
			return nil, err
		}
		cfg.Logger.Info("Opened module storage", "path", cfg.Path, "replicated", false)
		return &Store{db: db}, nil
	}

	return openReplicated(ctx, cfg)
}

func openReplicated(ctx context.Context, cfg Config) (*Store, error) {
	client, err := litestream.NewReplicaClientFromURL(cfg.ReplicaURL)
	if err != nil {
		return nil, fmt.Errorf("replica url: %w", err)
	}
	if s3Client, ok := client.(*s3.ReplicaClient); ok {
		if cfg.AccessKeyID != "" {
			s3Client.AccessKeyID = cfg.AccessKeyID
		}
		if cfg.SecretAccessKey != "" {
			s3Client.SecretAccessKey = cfg.SecretAccessKey
		}
	}

	replicaDB := litestream.NewDB(cfg.Path)
	replicaDB.Replica = litestream.NewReplicaWithClient(replicaDB, client)

	if err := replicaDB.EnsureExists(ctx); err != nil {
		return nil, fmt.Errorf("restore %s from %s: %w", cfg.Path, redactURL(cfg.ReplicaURL), err)
	}

	store := litestream.NewStore([]*litestream.DB{replicaDB}, litestream.DefaultCompactionLevels)
	store.Logger = cfg.Logger.With("component", "litestream")
	store.SetShutdownSyncTimeout(shutdownSyncTimeout)
	if err := store.Open(ctx); err != nil {
		return nil, fmt.Errorf("start replication: %w", err)
	}

	db, err := openPool(cfg.Path, true)
	if err != nil {
		closeErr := store.Close(context.WithoutCancel(ctx))
		return nil, errors.Join(err, closeErr)
	}
	// Litestream attaches to the file (holding the read lock that keeps
	// anyone else from checkpointing) on its first sync, which its monitor
	// would otherwise run only after an interval.
	if err := replicaDB.Sync(ctx); err != nil {
		closeErr := errors.Join(db.Close(), store.Close(context.WithoutCancel(ctx)))
		return nil, errors.Join(fmt.Errorf("start replication: %w", err), closeErr)
	}

	cfg.Logger.Info("Opened module storage", "path", cfg.Path, "replicated", true, "replica", redactURL(cfg.ReplicaURL))
	return &Store{db: db, litestream: store, replicaDB: replicaDB}, nil
}

// openPool opens the application's connection pool. Pragmas go in the DSN
// because sql.DB is a pool: a PRAGMA run through Exec reaches only the one
// connection that happened to run it.
func openPool(path string, replicated bool) (*sql.DB, error) {
	pragmas := []string{
		"journal_mode(wal)",
		"busy_timeout(5000)",
		// Every committed write is on disk before it is acknowledged. In local
		// mode there is no off-host copy, so this is the only durability.
		"synchronous(full)",
	}
	if replicated {
		pragmas = append(pragmas, "wal_autocheckpoint(0)")
	}

	query := url.Values{}
	for _, pragma := range pragmas {
		query.Add("_pragma", pragma)
	}
	db, err := sql.Open(driverName, path+"?"+query.Encode())
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	if err := db.Ping(); err != nil {
		closeErr := db.Close()
		return nil, errors.Join(fmt.Errorf("open %s: %w", path, err), closeErr)
	}
	return db, nil
}

// DB is the application's connection pool.
func (s *Store) DB() *sql.DB {
	return s.db
}

// Replicated reports whether Litestream is streaming this database.
func (s *Store) Replicated() bool {
	return s.litestream != nil
}

// InSync reports whether the replica holds every transaction committed
// locally. It asks the replica, so it performs I/O.
func (s *Store) InSync(ctx context.Context) (bool, error) {
	if s.replicaDB == nil {
		return false, errors.New("replication: store is not replicated")
	}
	status, err := s.replicaDB.SyncStatus(ctx)
	if err != nil {
		return false, err
	}
	return status.InSync, nil
}

// Sync pushes every committed transaction to the replica and waits for it.
func (s *Store) Sync(ctx context.Context) error {
	if s.replicaDB == nil {
		return errors.New("replication: store is not replicated")
	}
	return s.replicaDB.SyncAndWait(ctx)
}

// Close closes the application's pool first, so no write can land after the
// final flush, then stops Litestream, which flushes what remains to the
// replica.
//
// Litestream only flushes a database it has attached to, so Close syncs once
// before closing the pool; that also means Litestream, not the pool, holds
// the last connection, and closing the pool cannot checkpoint the WAL away
// from under it.
func (s *Store) Close(ctx context.Context) error {
	if s.litestream == nil {
		return s.db.Close()
	}
	syncErr := s.replicaDB.Sync(ctx)
	poolErr := s.db.Close()
	return errors.Join(syncErr, poolErr, s.litestream.Close(ctx))
}

// redactURL drops credentials and the query (which may carry an endpoint
// token) from a replica URL before it is logged or wrapped into an error.
func redactURL(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil {
		return "<unparseable replica url>"
	}
	parsed.User = nil
	parsed.RawQuery = ""
	return parsed.String()
}
