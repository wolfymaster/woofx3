package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nkeys"
	"github.com/spf13/viper"

	"github.com/wolfymaster/woofx3/workflow/internal/adapters/sqlite"
	"github.com/wolfymaster/woofx3/workflow/internal/core"
	"github.com/wolfymaster/woofx3/workflow/internal/workflow/temporal"
)

func main() {
	// Load configuration
	viper.SetConfigFile("config.yaml")
	if err := viper.ReadInConfig(); err != nil {
		slog.Error("failed to read config", "error", err)
		os.Exit(1)
	}

	// Setup logger
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	// Initialize repositories
	eventRepo := sqlite.NewEventRepository()
	workflowRepo := sqlite.NewWorkflowDefinitionRepository()

	// Connect to NATS
	nc, err := setupNATS()
	if err != nil {
		logger.Error("failed to connect to NATS", "error", err)
		os.Exit(1)
	}
	defer nc.Close()

	// Initialize Temporal client
	temporalClient, err := temporal.NewClient(
		viper.GetString("temporal.host"),
		viper.GetString("temporal.namespace"),
		"workflow",
		eventRepo,
		workflowRepo,
		nc,
	)
	if err != nil {
		logger.Error("failed to create Temporal client", "error", err)
		os.Exit(1)
	}
	defer temporalClient.Close()

	// Register custom activities
	temporalClient.RegisterActivity("media_alert", temporal.MediaAlert)

	// Subscribe to workflow events
	sub, err := nc.Subscribe("workflow.>", func(msg *nats.Msg) {
		// Extract event type from subject
		eventType := strings.TrimPrefix(msg.Subject, "workflow.")

		// Parse event payload
		var event *core.Event
		if err := json.Unmarshal(msg.Data, &event); err != nil {
			logger.Error("failed to parse event payload", "error", err)
			return
		}

		if event.ID == "" {
			event.ID = fmt.Sprintf("%d", time.Now().UnixNano())
		}

		// Create event object
		// event := &core.Event{
		// 	ID:      fmt.Sprintf("%d", time.Now().UnixNano()),
		// 	Type:    eventType,
		// 	Payload: payload,
		// }

		// Handle event
		if err := temporalClient.HandleEvent(context.Background(), event); err != nil {
			logger.Error("failed to handle event", "error", err, "event_type", eventType)
		}
	})
	if err != nil {
		logger.Error("failed to subscribe to workflow events", "error", err)
		os.Exit(1)
	}
	defer sub.Unsubscribe()

	// Wait for shutdown signal
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh

	logger.Info("shutting down...")
}

func setupNATS() (*nats.Conn, error) {
	// Parse NKey seed
	seed := viper.GetString("nats.nkey_seed")
	kp, err := nkeys.FromSeed([]byte(seed))
	if err != nil {
		return nil, fmt.Errorf("failed to parse NKey seed: %w", err)
	}

	// Create JWT handler
	jwtHandler := func() (string, error) {
		return viper.GetString("nats.user_jwt"), nil
	}

	// Create signature handler
	sigHandler := func(nonce []byte) ([]byte, error) {
		return kp.Sign(nonce)
	}

	// Create NATS connection with JWT and NKey handlers
	nc, err := nats.Connect(
		viper.GetString("nats.url"),
		nats.UserJWT(jwtHandler, sigHandler),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to NATS: %w", err)
	}

	return nc, nil
}
