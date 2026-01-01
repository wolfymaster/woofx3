package workers

import (
	"context"
	"log/slog"
	"time"

	"github.com/wolfymaster/woofx3/db/database/repository"
)

type CleanupWorker struct {
	repo            *repository.DbEventRepository
	logger          *slog.Logger
	cleanupInterval time.Duration
	retentionPeriod time.Duration
	ctx             context.Context
	cancel          context.CancelFunc
}

func NewCleanupWorker(
	repo *repository.DbEventRepository,
	logger *slog.Logger,
	cleanupInterval time.Duration,
	retentionPeriod time.Duration,
) *CleanupWorker {
	ctx, cancel := context.WithCancel(context.Background())

	return &CleanupWorker{
		repo:            repo,
		logger:          logger,
		cleanupInterval: cleanupInterval,
		retentionPeriod: retentionPeriod,
		ctx:             ctx,
		cancel:          cancel,
	}
}

func (w *CleanupWorker) Start() {
	w.logger.Info("cleanup worker starting",
		"cleanup_interval", w.cleanupInterval,
		"retention_period", w.retentionPeriod,
	)

	go w.run()
}

func (w *CleanupWorker) Stop() {
	w.logger.Info("cleanup worker stopping")
	w.cancel()
}

func (w *CleanupWorker) run() {
	ticker := time.NewTicker(w.cleanupInterval)
	defer ticker.Stop()

	for {
		select {
		case <-w.ctx.Done():
			w.logger.Info("cleanup worker stopped")
			return

		case <-ticker.C:
			if err := w.cleanup(); err != nil {
				w.logger.Error("failed to cleanup old events", "error", err)
			}
		}
	}
}

func (w *CleanupWorker) cleanup() error {
	w.logger.Debug("cleaning up old events", "older_than", w.retentionPeriod)

	err := w.repo.CleanupOldEvents(w.retentionPeriod)
	if err != nil {
		return err
	}

	w.logger.Debug("cleanup complete")
	return nil
}
