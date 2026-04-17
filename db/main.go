package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/wolfymaster/woofx3/common/logging"
	"github.com/wolfymaster/woofx3/common/runtime"
	"github.com/wolfymaster/woofx3/common/runtime/monitor"
	"github.com/wolfymaster/woofx3/common/runtime/service"
	"github.com/wolfymaster/woofx3/db/app/routes"
	"github.com/wolfymaster/woofx3/db/app/services"
	"github.com/wolfymaster/woofx3/db/config"
)

func main() {
	env, err := runtime.LoadRuntimeEnv(nil)
	if err != nil {
		panic("failed to load runtime env for logging: " + err.Error())
	}

	sharedLogger, err := logging.New(logging.Config{
		ServiceName:             "db",
		LogDirectory:            strings.TrimSpace(env["WOOFX3_ROOT_PATH"]) + "/logs",
		AllowRuntimeLevelChange: true,
	})
	if err != nil {
		panic("failed to initialize logger: " + err.Error())
	}
	defer sharedLogger.Close()
	logger := sharedLogger.Slog()

	app := NewDatabaseApp(&DatabaseAppConfig{Logger: logger})
	natsSvc := service.NewNATS(logger, "nats", "messagebus")
	natsMonitor := monitor.NewNATS("nats", natsSvc, "db", "HEARTBEAT", 15*time.Second, logger)
	dbEnvConfig := &config.DatabaseEnvConfig{}

	rt, err := runtime.NewRuntime(&runtime.RuntimeConfig{
		Application: app,
		EnvConfig:   dbEnvConfig,
		RuntimeInit: func(ctx context.Context, application runtime.Application) error {
			logger.Info("Database runtime initializing")

			appCtx := application.Context()
			cfg := runtime.GetConfig[*config.DatabaseEnvConfig](appCtx)
			databaseURL := cfg.DatabaseURL
			badgerPath := cfg.BadgerPath
			httpPort := cfg.DatabaseProxyPort

			if cfg.LogLevel != "" {
				var parsedLevel slog.Level
				if err := parsedLevel.UnmarshalText([]byte(cfg.LogLevel)); err == nil {
					if err := sharedLogger.SetLevel(parsedLevel); err != nil {
						logger.Warn("Failed to set runtime log level", "error", err, "level", cfg.LogLevel)
					}
				} else {
					logger.Warn("Invalid log level in config", "error", err, "level", cfg.LogLevel)
				}
			}

			postgresSvc := services.NewPostgresService(databaseURL, logger)
			if err := application.Register("postgres", postgresSvc); err != nil {
				return err
			}

			badgerSvc := services.NewBadgerService(badgerPath, logger)
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

			httpSvc := services.NewHTTPServerService(app, httpPort, logger, routes.SetupAllRoutes)
			if err := application.Register("http", httpSvc); err != nil {
				return err
			}

			return nil
		},
		RuntimeTerminate: func(ctx context.Context, application runtime.Application) error {
			logger.Info("Database runtime terminating")
			return nil
		},
		HealthMonitor: natsMonitor,
		Logger:        logger,
	})

	if err != nil {
		panic("failed to create runtime: " + err.Error())
	}

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
