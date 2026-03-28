package services

import (
	"context"
	"log/slog"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/wolfymaster/woofx3/common/runtime"
	"github.com/wolfymaster/woofx3/db/app/workers"
	"github.com/wolfymaster/woofx3/db/database/repository"
	"gorm.io/gorm"
)

type WorkerService struct {
	*runtime.BaseService[*WorkerService]
	logger          *slog.Logger
	db              *gorm.DB
	natsConn        *nats.Conn
	eventCache      *workers.EventCache
	publisherWorker *workers.PublisherWorker
	ackWorker       *workers.AckWorker
	cleanupWorker   *workers.CleanupWorker
	metricsWorker   *workers.MetricsWorker
	eventPublisher  *workers.EventPublisher
}

func NewWorkerService(logger *slog.Logger) *WorkerService {
	service := &WorkerService{
		BaseService: runtime.NewBaseServiceWithDeps[*WorkerService]("workers", "workers", nil, false, []string{"postgres", "nats"}), // Workers don't need external heartbeat monitoring
		logger:      logger,
	}
	// Initialize client after struct creation
	service.SetClient(service)
	return service
}

func (s *WorkerService) Connect(ctx context.Context, appCtx *runtime.ApplicationContext) error {
	s.logger.Info("Initializing worker service")

	if postgresSvc, ok := appCtx.GetService("postgres"); ok {
		if typedSvc, ok := postgresSvc.(interface{ Client() *gorm.DB }); ok {
			s.db = typedSvc.Client()
		} else {
			s.logger.Warn("Postgres service does not implement Client() *gorm.DB")
		}
	}

	if natsSvc, ok := appCtx.GetService("nats"); ok {
		if typedSvc, ok := natsSvc.(interface{ Connection() *nats.Conn }); ok {
			s.natsConn = typedSvc.Connection()
		} else {
			s.logger.Warn("NATS service does not implement Connection() *nats.Conn")
		}
	}

	if err := s.initializeWorkers(); err != nil {
		return err
	}

	s.startWorkers()

	return s.BaseService.Connect(ctx, appCtx)
}

func (s *WorkerService) initializeWorkers() error {
	s.logger.Info("Initializing workers with database and NATS connections")

	workersRepo := repository.NewDbEventRepository(s.db)
	eventCache := workers.NewEventCache()
	eventPublisher := workers.NewEventPublisher(workersRepo, s.logger)
	workersConfig := workers.LoadConfig()

	s.publisherWorker = workers.NewPublisherWorker(workersRepo, s.natsConn, eventCache, s.logger, workersConfig)
	s.ackWorker = workers.NewAckWorker(workersRepo, s.natsConn, eventCache, s.logger)
	s.cleanupWorker = workers.NewCleanupWorker(workersRepo, s.logger, workersConfig.CleanupInterval, workersConfig.RetentionPeriod)
	s.metricsWorker = workers.NewMetricsWorker(eventCache, s.logger, 30*time.Second)
	s.eventCache = eventCache
	s.eventPublisher = eventPublisher

	s.logger.Info("Worker configuration loaded",
		"poll_interval", workersConfig.PollInterval,
		"retry_interval", workersConfig.RetryInterval,
		"default_ttl", workersConfig.DefaultTTL,
		"batch_size", workersConfig.BatchSize,
		"cleanup_interval", workersConfig.CleanupInterval,
		"retention_period", workersConfig.RetentionPeriod,
	)

	return nil
}

func (s *WorkerService) startWorkers() {
	s.logger.Info("Starting workers")
	if s.publisherWorker != nil {
		s.publisherWorker.Start()
	}
	if s.ackWorker != nil {
		if err := s.ackWorker.Start(); err != nil {
			s.logger.Error("Failed to start ack worker", "error", err)
		}
	}
	if s.cleanupWorker != nil {
		s.cleanupWorker.Start()
	}
	if s.metricsWorker != nil {
		s.metricsWorker.Start()
	}
	if s.eventCache != nil {
		s.logger.Info("Workers started", "cache_size", s.eventCache.Size())
	} else {
		s.logger.Info("Workers started (no cache)")
	}
}

func (s *WorkerService) stopWorkers() {
	s.logger.Info("Stopping workers")
	if s.publisherWorker != nil {
		s.publisherWorker.Stop()
	}
	if s.ackWorker != nil {
		s.ackWorker.Stop()
	}
	if s.cleanupWorker != nil {
		s.cleanupWorker.Stop()
	}
	if s.metricsWorker != nil {
		s.metricsWorker.Stop()
	}
	if s.eventCache != nil {
		s.logger.Info("Workers stopped", "cache_size", s.eventCache.Size())
	} else {
		s.logger.Info("Workers stopped (no cache)")
	}
}

func (s *WorkerService) Disconnect(ctx context.Context) error {
	s.logger.Info("Disconnecting worker service")
	s.stopWorkers()
	return s.BaseService.Disconnect(ctx)
}

func (s *WorkerService) EventCache() *workers.EventCache {
	return s.eventCache
}

func (s *WorkerService) EventPublisher() *workers.EventPublisher {
	return s.eventPublisher
}
