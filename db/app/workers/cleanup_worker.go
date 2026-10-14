package workers

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/repository"
)

// sessionCompactionBatch is how many sessions one read of the sessions due
// for compaction returns.
const sessionCompactionBatch = 100

// CleanupRepositories are the tables the cleanup worker prunes.
type CleanupRepositories struct {
	Outbox     *repository.DbEventRepository
	Facts      *repository.ViewerFactRepository
	UserEvents *repository.UserEventRepository
	Alerts     *repository.AlertRepository
	Workflows  *repository.WorkflowRepository
}

type CleanupWorker struct {
	repos                 CleanupRepositories
	logger                *slog.Logger
	cleanupInterval       time.Duration
	retentionPeriod       time.Duration
	factRetention         time.Duration
	factPruneBatch        int
	eventDetailRetention  time.Duration
	eventDetailPruneBatch int
	ctx                   context.Context
	cancel                context.CancelFunc
}

func NewCleanupWorker(repos CleanupRepositories, logger *slog.Logger, config Config) *CleanupWorker {
	ctx, cancel := context.WithCancel(context.Background())

	return &CleanupWorker{
		repos:                 repos,
		logger:                logger,
		cleanupInterval:       config.CleanupInterval,
		retentionPeriod:       config.RetentionPeriod,
		factRetention:         config.FactDedupeRetention,
		factPruneBatch:        config.FactDedupePruneBatch,
		eventDetailRetention:  config.EventDetailRetention,
		eventDetailPruneBatch: config.EventDetailPruneBatch,
		ctx:                   ctx,
		cancel:                cancel,
	}
}

func (w *CleanupWorker) Start() {
	w.logger.Info("cleanup worker starting",
		"cleanup_interval", w.cleanupInterval,
		"retention_period", w.retentionPeriod,
		"fact_dedupe_retention", w.factRetention,
		"event_detail_retention", w.eventDetailRetention,
	)

	go w.run()
}

func (w *CleanupWorker) Stop() {
	w.logger.Info("cleanup worker stopping")
	w.cancel()
}

func (w *CleanupWorker) run() {
	// Compacting at startup backfills every session that ended before
	// compaction existed, or while the api could not ask for it, without
	// waiting out the first interval. Pruning needs no such ordering: it only
	// ever deletes what a compaction already holds.
	if err := w.compactSessions(); err != nil {
		w.logger.Error("failed to compact stream sessions", "error", err)
	}

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

// cleanup runs every step even when one fails: each prunes a different table
// and none depends on another having run.
func (w *CleanupWorker) cleanup() error {
	w.logger.Debug("cleaning up old events", "older_than", w.retentionPeriod)

	var errs []error
	if err := w.repos.Outbox.CleanupOldEvents(w.retentionPeriod); err != nil {
		errs = append(errs, fmt.Errorf("outbox: %w", err))
	}

	pruned, err := w.repos.Facts.PruneAppliedEvents(time.Now().Add(-w.factRetention), w.factPruneBatch)
	if err != nil {
		errs = append(errs, fmt.Errorf("applied fact events: %w", err))
	}
	w.logger.Debug("pruned applied fact events", "deleted", pruned)

	if err := w.compactSessions(); err != nil {
		errs = append(errs, err)
	}
	if err := w.pruneEventDetail(); err != nil {
		errs = append(errs, err)
	}

	w.logger.Debug("cleanup complete")
	return errors.Join(errs...)
}

// compactSessions compacts every closed session whose compact rows are
// missing or out of date (see UserEventRepository.SessionsToCompact). A
// session that fails is tried once per pass, so one bad session cannot hold
// up the rest or spin the pass.
func (w *CleanupWorker) compactSessions() error {
	tried := map[uuid.UUID]bool{}
	var errs []error
	compacted := 0
	for {
		due, err := w.repos.UserEvents.SessionsToCompact(sessionCompactionBatch)
		if err != nil {
			errs = append(errs, fmt.Errorf("list sessions to compact: %w", err))
			break
		}
		progressed := false
		for _, id := range due {
			if tried[id] {
				continue
			}
			tried[id] = true
			progressed = true
			if _, err := w.repos.UserEvents.Compact(id, time.Now()); err != nil {
				errs = append(errs, fmt.Errorf("compact stream session %s: %w", id, err))
				continue
			}
			compacted++
		}
		if !progressed || len(due) < sessionCompactionBatch {
			break
		}
	}
	if compacted > 0 {
		w.logger.Info("compacted stream sessions", "sessions", compacted)
	}
	return errors.Join(errs...)
}

// pruneEventDetail deletes the detail older than the retention window: raw
// events that a compaction holds, and alerts and workflow runs that settled.
func (w *CleanupWorker) pruneEventDetail() error {
	if w.eventDetailRetention <= 0 {
		return fmt.Errorf("event detail retention must be positive, got %s; nothing pruned", w.eventDetailRetention)
	}
	now := time.Now()
	before := now.Add(-w.eventDetailRetention)
	var errs []error

	events, err := w.repos.UserEvents.PruneCompactedEvents(before, w.eventDetailPruneBatch, now)
	if err != nil {
		errs = append(errs, fmt.Errorf("user events: %w", err))
	}
	alerts, err := w.repos.Alerts.PruneSettled(before, w.eventDetailPruneBatch)
	if err != nil {
		errs = append(errs, fmt.Errorf("alerts: %w", err))
	}
	runs, err := w.repos.Workflows.PruneSettledRuns(before, w.eventDetailPruneBatch)
	if err != nil {
		errs = append(errs, fmt.Errorf("workflow runs: %w", err))
	}
	w.logger.Debug("pruned event detail", "before", before, "user_events", events, "alerts", alerts, "workflow_runs", runs)
	return errors.Join(errs...)
}
