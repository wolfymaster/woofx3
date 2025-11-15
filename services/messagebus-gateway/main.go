package main

import (
	"context"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/wolfymaster/woofx3/messagebus/internal/config"
	"github.com/wolfymaster/woofx3/messagebus/internal/gateway"
	"github.com/wolfymaster/woofx3/messagebus/internal/health"
)

func main() {
	var configPath = flag.String("config", "", "Path to configuration file")
	flag.Parse()

	// Setup structured logging
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	// Load configuration
	cfg, err := config.Load(*configPath)
	if err != nil {
		logger.Error("Failed to load configuration", "error", err)
		os.Exit(1)
	}

	logger.Info("Starting messagebus gateway", "config", cfg)

	// Create gateway instance
	gw, err := gateway.New(cfg, logger)
	if err != nil {
		logger.Error("Failed to create gateway", "error", err)
		os.Exit(1)
	}

	// Setup health checker
	healthChecker := health.New(gw, logger)

	// Setup HTTP server with routes
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", gw.HandleWebSocket)
	mux.HandleFunc("/health", healthChecker.Health)
	mux.HandleFunc("/ready", healthChecker.Ready)

	server := &http.Server{
		Addr:         cfg.Server.Address,
		Handler:      mux,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// Start server in background
	go func() {
		logger.Info("Server starting", "address", cfg.Server.Address)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("Server failed", "error", err)
			os.Exit(1)
		}
	}()

	// Wait for shutdown signal
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	<-sigChan

	logger.Info("Shutting down server...")

	// Graceful shutdown
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Shutdown HTTP server
	if err := server.Shutdown(ctx); err != nil {
		logger.Error("Server shutdown failed", "error", err)
	}

	// Close gateway
	gw.Close()

	logger.Info("Server shutdown complete")
}
