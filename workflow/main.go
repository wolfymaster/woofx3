package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	barkloader "github.com/wolfymaster/woofx3/clients/barkloader"
	db "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/common/logging"
	"github.com/wolfymaster/woofx3/common/runtime"
	"github.com/wolfymaster/woofx3/common/runtime/monitor"
	"github.com/wolfymaster/woofx3/common/runtime/service"
)

func main() {
	env, err := runtime.LoadRuntimeEnv(nil)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to load runtime env for logging: %v\n", err)
		os.Exit(1)
	}

	sharedLogger, err := logging.New(logging.Config{
		ServiceName:  "workflow",
		LogDirectory: strings.TrimSpace(env["WOOFX3_ROOT_PATH"]) + "/logs",
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to initialize logger: %v\n", err)
		os.Exit(1)
	}
	defer sharedLogger.Close()
	logger := sharedLogger.Slog()
	slogAdapter := &SlogAdapter{logger: logger}

	// Messagebus (does not depend on config values)
	natsSvc := service.NewNATS(logger, "nats", "messagebus")
	natsMonitor := monitor.NewNATS("nats", natsSvc, "workflow", "HEARTBEAT", 15*time.Second, slogAdapter)

	// Create application shell; db clients are wired in RuntimeInit after config is loaded.
	app := NewWorkflowApp(logger)

	rt, err := runtime.NewRuntime(&runtime.RuntimeConfig{
		Application: app,
		EnvConfig:   &WorkflowEnvConfig{},
		RuntimeInit: func(ctx context.Context, application runtime.Application) error {
			logger.Info("Workflow runtime initializing")

			appCtx := application.Context()
			cfg := runtime.GetConfig[*WorkflowEnvConfig](appCtx)

			logger.Info("config",
				"barkloaderWsUrl", cfg.BarkloaderWsURL,
				"databaseProxyUrl", cfg.DatabaseProxyURL,
			)

			// Database
			httpClient := &http.Client{}
			dbClient := db.NewDbProxyClient(cfg.DatabaseProxyURL, httpClient)
			dbProxyService := service.NewDbProxyService(dbClient, true)
			logger.Info("Database client configured", "url", cfg.DatabaseProxyURL)

			if err := application.Register("db", dbProxyService); err != nil {
				return err
			}

			// Barkloader
			barkloaderConfig := barkloader.DefaultConfig(cfg.BarkloaderWsURL, logger)
			barkloaderConfig.Token = cfg.BarkloaderKey
			barkloaderService := service.NewBarkloaderService(
				barkloader.New(*barkloaderConfig),
				false,
			)
			logger.Info("Barkloader service configured", "url", cfg.BarkloaderWsURL)

			if err := application.Register("barkloader", barkloaderService); err != nil {
				return err
			}

			// Messagebus
			if err := application.Register("nats", natsSvc); err != nil {
				return err
			}

			// Wire db clients into the application now that config is loaded
			app.SetDbClients(dbClient.Workflow, dbClient.Module)

			return nil
		},
		RuntimeTerminate: func(ctx context.Context, application runtime.Application) error {
			logger.Info("Workflow runtime terminating")
			return nil
		},
		HealthMonitor: natsMonitor,
		Logger:        slogAdapter,
	})

	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to create runtime: %v\n", err)
		os.Exit(1)
	}

	rt.Start()

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan

	logger.Info("Shutting down workflow service")

	if err := rt.Stop(); err != nil {
		logger.Error("Shutdown error", "error", err)
		os.Exit(1)
	}

	logger.Info("Workflow service stopped")
}
