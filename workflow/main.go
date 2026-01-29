package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	barkloader "github.com/wolfymaster/woofx3/clients/barkloader"
	db "github.com/wolfymaster/woofx3/clients/db"
	natsclient "github.com/wolfymaster/woofx3/clients/nats"
	"github.com/wolfymaster/woofx3/common/runtime"
	"github.com/wolfymaster/woofx3/common/runtime/service"
)

func main() {
	// load configuration
	config, err := LoadConfiguration()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to load configuration: %v\n", err)
		os.Exit(1)
	}

	// setup logger
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	// required environment variables
	if config.BarkloaderWsURL == "" {
		logger.Error("Missing barkloader WS Url")
		os.Exit(1)
	}

	if config.DatabaseProxyURL == "" {
		logger.Error("Database proxy URL not configured, workflow loading from DB will be disabled")
		os.Exit(1)
	}

	// Barkloader
	barkloaderService := service.NewBarkloaderService(
		barkloader.New(*barkloader.DefaultConfig(config.BarkloaderWsURL, logger)), // barkloader client
		false,
	)
	logger.Info("Barkloader service configured", "url", config.BarkloaderWsURL)

	// Messagebus
	messageBus, err := natsclient.FromEnv(logger)
	if err != nil {
		logger.Error("Failed to create NATS client", "error", err)
		os.Exit(1)
	}

	// Database
	httpClient := &http.Client{}
	dbClient := db.NewDbProxyClient(config.DatabaseProxyURL, httpClient)
	dbProxyService := service.NewDbProxyService(dbClient, true)
	logger.Info("Database client configured", "url", config.DatabaseProxyURL)

	rt := runtime.NewRuntime(&runtime.RuntimeConfig{
		Application: NewWorkflowApp(logger, dbClient.Workflow),
		RuntimeInit: func(ctx context.Context, application runtime.Application) error {
			logger.Info("Workflow runtime initializing")

			// Register database service
			if err := application.Register("db", dbProxyService); err != nil {
				return err
			}

			// Register messageBus service
			svc := runtime.NewBaseService("messageBus", "nats", messageBus, false)
			if err := application.Register("messageBus", svc); err != nil {
				return err
			}

			// Register barkloader service
			if err := application.Register("barkloader", barkloaderService); err != nil {
				return err
			}

			return nil
		},
		RuntimeTerminate: func(ctx context.Context, application runtime.Application) error {
			logger.Info("Workflow runtime terminating")
			return nil
		},
		Heartbeat:   runtime.CreateNATSHeartbeat(messageBus, "workflow", "HEARTBEAT", nil),
		HealthCheck: runtime.CreateNATSHealthCheck(messageBus, "HEARTBEAT"),
		Logger:      logger,
	})

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
