package main

import (
	"context"
	"log"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"

	middleware "github.com/wolfymaster/woofx3/db/cmd/server/middleware"
	"github.com/wolfymaster/woofx3/db/cmd/server/routes"
	"github.com/wolfymaster/woofx3/db/internal/types"
)

func main() {
	godotenv.Load("../../.env")

	ctx := context.Background()
	app := Bootstrap(ctx)

	// Initialize Casbin middleware
	casbinMiddleware, err := middleware.NewCasbinMiddleware(app.Casbin)
	if err != nil {
		log.Fatalf("Failed to initialize Casbin: %v", err)
	}

	// http mux
	mux := http.NewServeMux()

	// Add Routes
	routes.CommandRoutes(mux, app, casbinMiddleware)
	routes.UserRoutes(mux, app)
	routes.SettingsRoutes(mux, app)
	routes.PermissionRoutes(mux, app)

	// get the correct port
	port := os.Getenv("DATABASE_PROXY_PORT")
	if port == "" {
		slog.ErrorContext(ctx, "DATABASE_PROXY_PORT is not set")
		os.Exit(1)
	}

	// wrap the mux with middleware
	var handler http.Handler = mux
	handler = casbinMiddleware.HTTPMiddleware(handler)

	// create server
	server := &http.Server{
		Addr:    ":" + port,
		Handler: handler,
	}

	go handleGracefulShutdown(server, app)

	slog.Info("Starting server", "port", port)

	// Start the server
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		slog.ErrorContext(ctx, "Failed to start server", "error", err)
		os.Exit(1)
	}
}

// Handle graceful shutdown
func handleGracefulShutdown(server *http.Server, app *types.App) {
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
	db, err := app.Db.DB()
	if err != nil {
		slog.Error("Error getting database connection", "error", err)
	}

	if err := db.Close(); err != nil {
		slog.Error("Error closing postgres database connection", "error", err)
	}

	badgerDB := app.BadgerDB
	if err := badgerDB.Close(); err != nil {
		slog.Error("Error closing badger database connection", "error", err)
	}

	slog.Info("Shutdown complete")
}
