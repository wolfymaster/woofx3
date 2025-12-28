package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	natsclient "github.com/wolfymaster/woofx3/clients/nats"
	"github.com/wolfymaster/woofx3/common/runtime"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

type SlogAdapter struct {
	logger *slog.Logger
}

// Note: BarkloaderService commented out for testing
// type BarkloaderService struct {
// 	*runtime.BaseService
// 	client *barkloader.Client
// }
//
// func (s *BarkloaderService) Connect(ctx context.Context) error {
// 	if err := s.client.Connect(); err != nil {
// 		return err
// 	}
// 	return s.BaseService.Connect(ctx)
// }
//
// func (s *BarkloaderService) Disconnect(ctx context.Context) error {
// 	s.client.Disconnect()
// 	return s.BaseService.Disconnect(ctx)
// }

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
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	adapter := &SlogAdapter{logger: logger}

	bus, err := natsclient.FromEnv(adapter)
	if err != nil {
		logger.Error("Failed to create NATS client", "error", err)
		os.Exit(1)
	}

	app := NewWorkflowApp(adapter)

	rt := runtime.NewRuntime(&runtime.RuntimeConfig{
		Application: app,
		RuntimeInit: func(ctx context.Context, application runtime.Application) error {
			logger.Info("Workflow runtime initializing")

			// Register messageBus service
			svc := runtime.NewBaseService("messageBus", "nats", bus, false)
			if err := application.Register("messageBus", svc); err != nil {
				return err
			}

			// Note: barkloader registration disabled for testing
			// To enable, uncomment the following:
			/*
			barkloaderWSURL := os.Getenv("BARKLOADER_WS_URL")
			if barkloaderWSURL == "" {
				barkloaderWSURL = "ws://localhost:24678"
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
			*/

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

	// Wait for runtime to initialize (health check runs every 5 seconds)
	time.Sleep(7 * time.Second)

	logger.Info("Triggering VIP follow event")
	event1 := &types.Event{
		ID:     "test-1",
		Type:   "follow.user.twitch",
		Source: "test",
		Time:   time.Now(),
		Data: map[string]interface{}{
			"user_name": "VIPUser",
			"is_vip":    true,
		},
	}

	if err := app.Engine().HandleEvent(event1); err != nil {
		logger.Error("Failed to handle event", "error", err)
	}

	time.Sleep(1 * time.Second)

	logger.Info("Triggering regular follow event")
	event2 := &types.Event{
		ID:     "test-2",
		Type:   "follow.user.twitch",
		Source: "test",
		Time:   time.Now(),
		Data: map[string]interface{}{
			"user_name": "RegularUser",
			"is_vip":    false,
		},
	}

	if err := app.Engine().HandleEvent(event2); err != nil {
		logger.Error("Failed to handle event", "error", err)
	}

	time.Sleep(500 * time.Millisecond)

	// Test donation workflow with different scenarios
	logger.Info("Testing donation workflow - small donation ($5)")
	donationSmall := &types.Event{
		ID:     "donation-1",
		Type:   "donation.received",
		Source: "test",
		Time:   time.Now(),
		Data: map[string]interface{}{
			"amount":        5,
			"donor_name":    "SmallDonor",
			"is_first_time": false,
			"has_message":   false,
		},
	}
	if err := app.Engine().HandleEvent(donationSmall); err != nil {
		logger.Error("Failed to handle event", "error", err)
	}

	time.Sleep(500 * time.Millisecond)

	logger.Info("Testing donation workflow - mid-tier donation ($25)")
	donationMid := &types.Event{
		ID:     "donation-2",
		Type:   "donation.received",
		Source: "test",
		Time:   time.Now(),
		Data: map[string]interface{}{
			"amount":        25,
			"donor_name":    "MidTierDonor",
			"is_first_time": false,
			"has_message":   false,
		},
	}
	if err := app.Engine().HandleEvent(donationMid); err != nil {
		logger.Error("Failed to handle event", "error", err)
	}

	time.Sleep(500 * time.Millisecond)

	logger.Info("Testing donation workflow - high tier ($75) with message (OR logic)")
	donationHigh := &types.Event{
		ID:     "donation-3",
		Type:   "donation.received",
		Source: "test",
		Time:   time.Now(),
		Data: map[string]interface{}{
			"amount":        75,
			"donor_name":    "HighTierDonor",
			"is_first_time": false,
			"has_message":   true,
		},
	}
	if err := app.Engine().HandleEvent(donationHigh); err != nil {
		logger.Error("Failed to handle event", "error", err)
	}

	time.Sleep(500 * time.Millisecond)

	logger.Info("Testing donation workflow - mega first-time donation ($150, AND logic)")
	donationMega := &types.Event{
		ID:     "donation-4",
		Type:   "donation.received",
		Source: "test",
		Time:   time.Now(),
		Data: map[string]interface{}{
			"amount":        150,
			"donor_name":    "MegaDonor",
			"is_first_time": true,
			"has_message":   true,
		},
	}
	if err := app.Engine().HandleEvent(donationMega); err != nil {
		logger.Error("Failed to handle event", "error", err)
	}

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
