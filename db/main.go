package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"

	"github.com/joho/godotenv"

	svc "github.com/wolfymaster/wolfyttv-db/services"
	"github.com/wolfymaster/wolfyttv-db/services/user"
	rpc "github.com/wolfymaster/wolfyttv/coredb"
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
	db, err := InitializeDB(ctx, dsn)
	if err != nil {
		slog.ErrorContext(ctx, "Failed to initialize database", "error", err)
	}

	// RPC server instance
	server := &svc.RPC{
		Db:          db,
		UserService: user.NewUserService(db),
	}
	twirpHandler := rpc.NewCoreDBServiceServer(server)

	// get the correct port
	port := os.Getenv("DATABASE_PROXY_PORT")
	if port == "" {
		slog.ErrorContext(ctx, "DATABASE_PROXY_PORT is not set")
	}

	// start the server
	err = http.ListenAndServe(":"+port, twirpHandler)
	if err != nil {
		slog.ErrorContext(ctx, "Failed to start server", "error", err)
	}
}
