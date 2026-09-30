package services

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/wolfymaster/woofx3/common/runtime"
	"github.com/wolfymaster/woofx3/db/database/replication"
)

// ModuleStorageServiceName is the runtime name of the module storage service;
// services that must stop before storage closes declare it as a dependency.
const ModuleStorageServiceName = "storage"

// ModuleStorageConfig says where module storage lives. See
// replication.Config for the replica fields.
type ModuleStorageConfig struct {
	Path            string
	ReplicaURL      string
	AccessKeyID     string
	SecretAccessKey string
	// BadgerPath is a Badger directory from before module storage moved to
	// SQLite; its values are imported once on connect. Empty means none.
	BadgerPath string
}

// ModuleStorageService owns the module storage file for the life of the
// process: it opens (and, when replicated, restores) the file before anything
// is served, and closes it last so the final flush to the replica holds every
// write.
type ModuleStorageService struct {
	*runtime.BaseService[*sql.DB]
	cfg    ModuleStorageConfig
	logger *slog.Logger

	mu    sync.Mutex
	store *replication.Store
}

func NewModuleStorageService(cfg ModuleStorageConfig, logger *slog.Logger) *ModuleStorageService {
	return &ModuleStorageService{
		BaseService: runtime.NewBaseService[*sql.DB](ModuleStorageServiceName, "database", nil, false),
		cfg:         cfg,
		logger:      logger,
	}
}

// Connect opens module storage and imports any Badger data. Any failure,
// a failed restore included, leaves the service unconnected, so db-proxy
// serves nothing rather than serving an empty store.
func (s *ModuleStorageService) Connect(ctx context.Context, appCtx *runtime.ApplicationContext) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.store != nil {
		return s.BaseService.Connect(ctx, appCtx)
	}

	store, err := replication.Open(ctx, replication.Config{
		Path:            s.cfg.Path,
		ReplicaURL:      s.cfg.ReplicaURL,
		AccessKeyID:     s.cfg.AccessKeyID,
		SecretAccessKey: s.cfg.SecretAccessKey,
		Logger:          s.logger,
	})
	if err != nil {
		return err
	}

	if err := s.prepare(ctx, store.DB()); err != nil {
		return errors.Join(err, store.Close(context.WithoutCancel(ctx)))
	}

	s.store = store
	s.SetClient(store.DB())
	return s.BaseService.Connect(ctx, appCtx)
}

func (s *ModuleStorageService) prepare(ctx context.Context, db *sql.DB) error {
	if err := EnsureStorageSchema(ctx, db); err != nil {
		return err
	}
	result, err := ImportBadgerStorage(ctx, db, s.cfg.BadgerPath, time.Now())
	if err != nil {
		return err
	}
	if result.ArchivedTo != "" {
		s.logger.Info("Imported module storage from Badger",
			"imported", result.Imported, "skipped", result.Skipped, "archivedTo", result.ArchivedTo)
	}
	return nil
}

// closeTimeout bounds Disconnect. It covers replication's own shutdown sync
// timeout with room to spare, and must stay below what the orchestrator leaves
// db-proxy between SIGTERM and SIGKILL: stopGracePeriod less
// dependentStopPeriod, in build/orchestrator/main.go.
const closeTimeout = 15 * time.Second

// Disconnect closes the pool and, when replicated, flushes to the replica.
//
// The runtime cancels its context before it disconnects services, so the
// flush runs on a context of its own: a cancelled one would abandon the final
// sync and lose the writes since the last one.
func (s *ModuleStorageService) Disconnect(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	var closeErr error
	if s.store != nil {
		s.logger.Info("Closing module storage")
		closeCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), closeTimeout)
		defer cancel()
		closeErr = s.store.Close(closeCtx)
		s.store = nil
		s.SetClient(nil)
	}
	return errors.Join(closeErr, s.BaseService.Disconnect(ctx))
}
