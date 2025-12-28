package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	natsclient "github.com/wolfymaster/woofx3/clients/nats"
	"github.com/wolfymaster/woofx3/common/runtime"
)

type MyApp struct {
	*runtime.BaseApplication
}

func (a *MyApp) Init(ctx context.Context) error {
	slog.Info("Application initializing")
	return nil
}

func (a *MyApp) Run(ctx context.Context) error {
	slog.Info("Application running")
	<-ctx.Done()
	slog.Info("Application context done")
	return nil
}

func (a *MyApp) Terminate(ctx context.Context) error {
	slog.Info("Application terminating")
	return nil
}

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	bus, err := natsclient.FromEnv(logger)
	if err != nil {
		logger.Error("Failed to create NATS client", "error", err)
		os.Exit(1)
	}

	app := &MyApp{
		BaseApplication: runtime.NewBaseApplication(),
	}

	rt := runtime.NewRuntime(&runtime.RuntimeConfig{
		Application: app,
		RuntimeInit: func(ctx context.Context, app runtime.Application) error {
			logger.Info("Runtime initializing")
			msgBusSvc := runtime.NewBaseService("messageBus", "nats", bus, false)
			return app.Register("messageBus", msgBusSvc)
		},
		RuntimeTerminate: func(ctx context.Context, app runtime.Application) error {
			logger.Info("Runtime terminating")
			return nil
		},
		Heartbeat:   runtime.CreateNATSHeartbeat(bus, "example-app", "HEARTBEAT", nil),
		HealthCheck: runtime.CreateNATSHealthCheck(bus, "HEARTBEAT"),
		Logger:      logger,
	})

	rt.Subscribe(func(state runtime.State) {
		logger.Info("State changed", "state", state)
	})

	rt.Start()

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan

	logger.Info("Shutdown signal received")

	if err := rt.Stop(); err != nil {
		logger.Error("Shutdown error", "error", err)
		os.Exit(1)
	}

	logger.Info("Application stopped successfully")
}
