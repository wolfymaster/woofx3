package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"

	svc "github.com/wolfymaster/wolfyttv-db/services"
	rpc "github.com/wolfymaster/wolfyttv/buf"
)

func main() {
	godotenv.Load("../.env")

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		slog.Error("DATABASE_URL is not set")
		os.Exit(1)
	}

	ctx := context.Background()

	// setup logger
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	// initialize the database
	db, err := InitializeDB(dsn, logger)
	if err != nil {
		slog.ErrorContext(ctx, "Failed to initialize database", "error", err)
	}

	slog.Info("Connected to the database!")

	// services
	userService := svc.NewUserService(db)
	eventService := svc.NewEventService(db)
	commandService := svc.NewCommandService(db)

	// http mux
	mux := http.NewServeMux()

	// service handlers
	userHandler := rpc.NewUserServiceServer(userService)
	mux.Handle(userHandler.PathPrefix(), userHandler)

	eventHandler := rpc.NewEventServiceServer(eventService)
	mux.Handle(eventHandler.PathPrefix(), eventHandler)

	commandHandler := rpc.NewCommandServiceServer(commandService)
	mux.Handle(commandHandler.PathPrefix(), commandHandler)

	// get the correct port
	port := os.Getenv("DATABASE_PROXY_PORT")
	if port == "" {
		slog.ErrorContext(ctx, "DATABASE_PROXY_PORT is not set")
		os.Exit(1)
	}

	// create server
	server := &http.Server{
		Addr:    ":" + port,
		Handler: mux,
	}

	sqlDB, err := db.DB()
	if err != nil {
		slog.Error("Failed to get database connection", "error", err)
	}

	go func() {
		// Listen for interrupt signals
		stop := make(chan os.Signal, 1)
		signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
		<-stop

		slog.Info("Shutting down server...")

		// Create a shutdown timeout context
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		// Shutdown HTTP server
		if err := server.Shutdown(shutdownCtx); err != nil {
			slog.Error("Error shutting down HTTP server", "error", err)
		}

		// Close database connections
		if err := sqlDB.Close(); err != nil {
			slog.Error("Error closing database connection", "error", err)
		}

		slog.Info("Shutdown complete")
	}()

	slog.Info("Starting server", "port", port)

	// Start the server
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		slog.ErrorContext(ctx, "Failed to start server", "error", err)
		sqlDB.Close()
		os.Exit(1)
	}
}
