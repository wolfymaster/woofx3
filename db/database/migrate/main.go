package main

import (
	"flag"
	"log/slog"
	"os"

	"github.com/wolfymaster/woofx3/common/runtime"
	db "github.com/wolfymaster/woofx3/db/database"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	env, err := runtime.LoadRuntimeEnv(nil)
	if err != nil {
		logger.Info("Failed to load runtime env", "error", err)
		os.Exit(1)
	}

	cmd := flag.String("cmd", "up", "migration command (up, down)")
	dbURL := flag.String("db", env["WOOFX3_DATABASE_URL"], "database connection string")
	flag.Parse()

	if *dbURL == "" {
		logger.Info("Database URL is required. Use -db flag, set WOOFX3_DATABASE_URL, or set databaseUrl in .woofx3.json")
		os.Exit(1)
	}

	// Initialize database connection
	database, err := db.InitializeDB(*dbURL, logger)
	if err != nil {
		logger.Info("Failed to connect to database", "error", err)
		os.Exit(1)
	}

	switch *cmd {
	case "up":
		logger.Info("Running migrations...")
		if err := Migrate(database); err != nil {
			logger.Info("Migration failed", "error", err)
			os.Exit(1)
		}
		logger.Info("Migrations completed successfully")

	case "down":
		logger.Info("Rolling back last migration...")
		if err := Rollback(database); err != nil {
			logger.Info("Rollback failed", "error", err)
			os.Exit(1)
		}
		logger.Info("Rollback completed successfully")

	default:
		logger.Info("Unknown command. Use 'up' or 'down'", "command", *cmd)
	}
}
