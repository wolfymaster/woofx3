package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	barkloader "github.com/wolfymaster/woofx3/clients/barkloader"
	dbv1 "github.com/wolfymaster/woofx3/clients/db"
	natsclient "github.com/wolfymaster/woofx3/clients/nats"
	"github.com/wolfymaster/woofx3/common/runtime"
)

type Config struct {
	BarkloaderWsURL  string `json:"barkloaderWsUrl"`
	DatabaseProxyURL string `json:"databaseProxyUrl"`
}

func loadConfiguration() (*Config, error) {
	config := &Config{}

	// Try to load from JSON file
	// First check current directory
	configFile := "conf.json"
	if _, err := os.Stat(configFile); os.IsNotExist(err) {
		// Try parent directory
		configFile = filepath.Join("..", "conf.json")
		if _, err := os.Stat(configFile); os.IsNotExist(err) {
			configFile = "" // No config file found
		}
	}

	if configFile != "" {
		data, err := os.ReadFile(configFile)
		if err != nil {
			return nil, fmt.Errorf("failed to read config file %s: %w", configFile, err)
		}

		if err := json.Unmarshal(data, config); err != nil {
			return nil, fmt.Errorf("failed to parse config file %s: %w", configFile, err)
		}
	}

	// Override with environment variables (take precedence)
	if envVal := os.Getenv("BARKLOADER_WS_URL"); envVal != "" {
		config.BarkloaderWsURL = envVal
	}
	if envVal := os.Getenv("DATABASE_PROXY_URL"); envVal != "" {
		config.DatabaseProxyURL = envVal
	}

	return config, nil
}

type SlogAdapter struct {
	logger *slog.Logger
}

type BarkloaderService struct {
	*runtime.BaseService
	client *barkloader.Client
}

func (s *BarkloaderService) Connect(ctx context.Context, appCtx *runtime.ApplicationContext) error {
	if err := s.client.Connect(); err != nil {
		return err
	}
	return s.BaseService.Connect(ctx, appCtx)
}

func (s *BarkloaderService) Disconnect(ctx context.Context) error {
	s.client.Disconnect()
	return s.BaseService.Disconnect(ctx)
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
	config, err := loadConfiguration()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to load configuration: %v\n", err)
		os.Exit(1)
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	bus, err := natsclient.FromEnv(logger)
	if err != nil {
		logger.Error("Failed to create NATS client", "error", err)
		os.Exit(1)
	}

	// Create DB client if configured
	var dbClient dbv1.WorkflowService
	if config.DatabaseProxyURL != "" {
		httpClient := &http.Client{}
		dbClient = dbv1.NewWorkflowServiceProtobufClient(config.DatabaseProxyURL, httpClient)
		logger.Info("Database client configured", "url", config.DatabaseProxyURL)
	} else {
		logger.Warn("Database proxy URL not configured, workflow loading from DB will be disabled")
	}

	app := NewWorkflowApp(logger, dbClient)

	rt := runtime.NewRuntime(&runtime.RuntimeConfig{
		Application: app,
		RuntimeInit: func(ctx context.Context, application runtime.Application) error {
			logger.Info("Workflow runtime initializing")

			// Register messageBus service
			svc := runtime.NewBaseService("messageBus", "nats", bus, false)
			if err := application.Register("messageBus", svc); err != nil {
				return err
			}

			// TODO: Register database service

			barkloaderWSURL := config.BarkloaderWsURL
			if barkloaderWSURL == "" {
				logger.Error("Missing barkloader WS Url")
				return errors.New("Missing barkloader WS Url")
			}

			barkloaderClient := barkloader.New(barkloader.Config{
				WSURL: barkloaderWSURL,
				OnOpen: func() {
					logger.Info("Barkloader client connected")
				},
				OnClose: func() {
					logger.Info("Barkloader client disconnected")
				},
				OnError: func(err error) {
					logger.Error("Barkloader client error", "error", err)
				},
				ReconnectTimeout: 5 * time.Second,
				MaxRetries:       0, // Infinite retries
			})

			barkloaderSvc := &BarkloaderService{
				BaseService: runtime.NewBaseService("barkloader", "barkloader", barkloaderClient, false),
				client:      barkloaderClient,
			}
			if err := application.Register("barkloader", barkloaderSvc); err != nil {
				return err
			}

			return nil
		},
		RuntimeTerminate: func(ctx context.Context, application runtime.Application) error {
			logger.Info("Workflow runtime terminating")
			return nil
		},
		Heartbeat:   runtime.CreateNATSHeartbeat(bus, "workflow", "HEARTBEAT", nil),
		HealthCheck: runtime.CreateNATSHealthCheck(bus, "HEARTBEAT"),
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
