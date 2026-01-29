package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"
	"github.com/wolfymaster/woofx3/common/runtime"
	"github.com/wolfymaster/woofx3/db/app/routes"
	"github.com/wolfymaster/woofx3/db/app/services"

	"github.com/wolfymaster/woofx3/db/config"
)

type SlogAdapter struct {
	logger *slog.Logger
}

// LazyHealthMonitor creates a NATSHealthMonitor lazily and switches to it when NATS becomes available
type LazyHealthMonitor struct {
	natsSvc       *services.NatsService
	logger        runtime.Logger
	appName       string
	subject       string
	timeout       time.Duration
	monitor       runtime.HealthMonitor
	ctx           context.Context
	natsConnected bool
}

func (l *LazyHealthMonitor) Liveness() error {
	// Check if NATS has become available and upgrade to NATS monitor
	client := l.natsSvc.Client()
	l.logger.Debug("LazyHealthMonitor liveness check", "has_client", client != nil, "nats_connected", l.natsConnected)

	if client != nil && !l.natsConnected {
		l.logger.Info("NATS client became available, upgrading to NATS health monitor")
		l.natsConnected = true

		// Stop old monitor if exists
		if l.monitor != nil {
			l.logger.Info("Stopping legacy health monitor")
			l.monitor.Stop()
		}

		// Create and start new NATS-based monitor
		l.logger.Info("Creating NATS health monitor")
		l.monitor = runtime.NewNATSHealthMonitorWithLogger(client, l.appName, l.subject, l.timeout, l.logger)
		if err := l.monitor.Start(l.ctx); err != nil {
			l.logger.Error("Failed to start NATS health monitor", "error", err)
			return err
		}
		l.logger.Info("Successfully upgraded to NATS health monitor")
	}

	if l.monitor == nil {
		l.logger.Debug("No monitor available yet")
		return nil // Not started yet
	}
	return l.monitor.Liveness()
}

func (l *LazyHealthMonitor) Start(ctx context.Context) error {
	// Stop existing monitor if any (for recovery scenarios)
	if l.monitor != nil {
		l.logger.Info("Stopping existing health monitor before restart")
		l.monitor.Stop()
		l.monitor = nil
	}

	l.ctx = ctx
	l.natsConnected = false

	client := l.natsSvc.Client()
	if client == nil {
		l.logger.Info("NATS client not available at start, using legacy health monitor (will upgrade when NATS connects)")
		// Fallback to legacy health monitor if no client available
		l.monitor = runtime.NewLegacyHealthMonitor(
			runtime.CreateNATSHeartbeat(nil, l.appName, l.subject, nil),
			runtime.CreateNATSHealthCheck(nil, l.subject),
		)
		return l.monitor.Start(ctx)
	}

	l.logger.Info("NATS client available at start, using NATS health monitor")
	l.natsConnected = true
	// Use new NATSHealthMonitor with proper timeout and logger
	l.monitor = runtime.NewNATSHealthMonitorWithLogger(client, l.appName, l.subject, l.timeout, l.logger)
	return l.monitor.Start(ctx)
}

func (l *LazyHealthMonitor) Stop() error {
	if l.monitor == nil {
		return nil // Not started yet
	}
	return l.monitor.Stop()
}

// Heartbeat implements CombinedHealthMonitor interface
func (l *LazyHealthMonitor) Heartbeat(ctx context.Context) error {
	if combined, ok := l.monitor.(runtime.CombinedHealthMonitor); ok {
		return combined.Heartbeat(ctx)
	}
	return nil
}

// HealthCheck implements CombinedHealthMonitor interface
func (l *LazyHealthMonitor) HealthCheck(ctx context.Context, services runtime.ServicesRegistry) (bool, error) {
	if combined, ok := l.monitor.(runtime.CombinedHealthMonitor); ok {
		return combined.HealthCheck(ctx, services)
	}
	return true, nil
}

func (s *SlogAdapter) Info(message string, args ...interface{}) {
	s.logger.Info(message, args...)
}

func (s *SlogAdapter) Error(message string, args ...interface{}) {
	s.logger.Error(message, args...)
}

func (s *SlogAdapter) Debug(message string, args ...interface{}) {
	s.logger.Debug(message, args...)
}

func (s *SlogAdapter) Warn(message string, args ...interface{}) {
	s.logger.Warn(message, args...)
}

func main() {
	godotenv.Load(".env")

	config, err := config.LoadConfiguration()
	if err != nil {
		slog.Error("Failed to load configuration", "error", err)
		os.Exit(1)
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	app := NewDatabaseApp(logger, config)

	natsSvc := services.NewNATSService(logger)

	rt := runtime.NewRuntime(&runtime.RuntimeConfig{
		Application: app,
		RuntimeInit: func(ctx context.Context, application runtime.Application) error {
			logger.Info("Database runtime initializing")

			postgresSvc := services.NewPostgresService(config.DatabaseURL, logger)
			if err := application.Register("postgres", postgresSvc); err != nil {
				return err
			}

			badgerSvc := services.NewBadgerService(config.BadgerPath, logger)
			if err := application.Register("badger", badgerSvc); err != nil {
				return err
			}

			if err := application.Register("nats", natsSvc); err != nil {
				return err
			}

			workerSvc := services.NewWorkerService(logger)
			if err := application.Register("workers", workerSvc); err != nil {
				return err
			}

			httpSvc := services.NewHTTPServerService(app, config, logger, routes.SetupAllRoutes)
			if err := application.Register("http", httpSvc); err != nil {
				return err
			}

			return nil
		},
		RuntimeTerminate: func(ctx context.Context, application runtime.Application) error {
			logger.Info("Database runtime terminating")
			return nil
		},
		HealthMonitor: func() runtime.HealthMonitor {
			// Create health monitor lazily - it will get the NATS client when started
			return &LazyHealthMonitor{
				natsSvc: natsSvc,
				logger:  &SlogAdapter{logger: logger},
				appName: "db",
				subject: "HEARTBEAT",
				timeout: 15 * time.Second,
			}
		}(),
		// Keep legacy functions for backward compatibility
		Heartbeat: func(ctx context.Context) error {
			client := natsSvc.Client()
			if client == nil {
				return nil
			}
			return runtime.CreateNATSHeartbeat(client, "db", "HEARTBEAT", nil)(ctx)
		},
		HealthCheck: func(ctx context.Context, services runtime.ServicesRegistry) (bool, error) {
			client := natsSvc.Client()
			if client == nil {
				return true, nil
			}
			return runtime.CreateNATSHealthCheck(client, "HEARTBEAT")(ctx, services)
		},
		Logger: &SlogAdapter{logger: logger},
	})

	rt.Start()

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan

	logger.Info("Shutting down database service")

	if err := rt.Stop(); err != nil {
		logger.Error("Shutdown error", "error", err)
		os.Exit(1)
	}

	logger.Info("Database service stopped")
}
