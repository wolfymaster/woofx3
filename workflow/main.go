package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	barkloader "github.com/wolfymaster/woofx3/clients/barkloader"
	db "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/common/runtime"
	"github.com/wolfymaster/woofx3/common/runtime/monitor"
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

	logger.Info("config", "config", config)

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

	slogAdapter := &SlogAdapter{logger: logger}

	// Messagebus
	natsSvc := service.NewNATS(logger, "nats", "messagebus")
	natsMonitor := monitor.NewNATS("nats", natsSvc, "workflow", "HEARTBEAT", 15*time.Second, slogAdapter)

	// Database
	httpClient := &http.Client{}
	dbClient := db.NewDbProxyClient(config.DatabaseProxyURL, httpClient)
	dbProxyService := service.NewDbProxyService(dbClient, true)
	logger.Info("Database client configured", "url", config.DatabaseProxyURL)

	rt, err := runtime.NewRuntime(&runtime.RuntimeConfig{
		Application: NewWorkflowApp(logger, dbClient.Workflow, dbClient.Module),
		EnvConfig:   &WorkflowEnvConfig{},
		RuntimeInit: func(ctx context.Context, application runtime.Application) error {
			logger.Info("Workflow runtime initializing")

			// Register database service
			if err := application.Register("db", dbProxyService); err != nil {
				return err
			}

			// Register messageBus service
			if err := application.Register("nats", natsSvc); err != nil {
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
