package workers

import (
	"context"
	"log/slog"
	"time"
)

type MetricsWorker struct {
	cache    *EventCache
	logger   *slog.Logger
	interval time.Duration
	ctx      context.Context
	cancel   context.CancelFunc
}

func NewMetricsWorker(
	cache *EventCache,
	logger *slog.Logger,
	interval time.Duration,
) *MetricsWorker {
	ctx, cancel := context.WithCancel(context.Background())

	return &MetricsWorker{
		cache:    cache,
		logger:   logger,
		interval: interval,
		ctx:      ctx,
		cancel:   cancel,
	}
}

func (w *MetricsWorker) Start() {
	w.logger.Info("metrics worker starting", "interval", w.interval)

	go w.run()
}

func (w *MetricsWorker) Stop() {
	w.logger.Info("metrics worker stopping")
	w.cancel()
}

func (w *MetricsWorker) run() {
	ticker := time.NewTicker(w.interval)
	defer ticker.Stop()

	for {
		select {
		case <-w.ctx.Done():
			w.logger.Info("metrics worker stopped")
			return

		case <-ticker.C:
			w.logMetrics()
		}
	}
}

func (w *MetricsWorker) logMetrics() {
	stats := w.cache.GetStats()

	w.logger.Info("db event metrics",
		"cache_size", stats.TotalEvents,
		"expired_events", stats.ExpiredEvents,
		"retrying_events", stats.RetryingEvents,
	)
}
