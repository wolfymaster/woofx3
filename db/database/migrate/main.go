package main

import (
	"flag"
	"log/slog"
	"os"

	"github.com/joho/godotenv"
	db "github.com/wolfymaster/woofx3/db/database"
)

func main() {
	_ = godotenv.Load()
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	// Parse command line flags
	cmd := flag.String("cmd", "up", "migration command (up, down)")
	dbURL := flag.String("db", os.Getenv("DATABASE_URL"), "database connection string")
	flag.Parse()

	if *dbURL == "" {
		logger.Info("Database URL is required. Use -db flag or set DATABASE_URL environment variable")
		os.Exit(1)
	}

	// Initialize database connection
	database, err := db.InitializeDB(*dbURL, logger)
	if err != nil {
		logger.Info("Failed to connect to database: %v", err)
		os.Exit(1)
	}

	switch *cmd {
	case "up":
		logger.Info("Running migrations...")
		if err := Migrate(database); err != nil {
			logger.Info("Migration failed: %v", err)
			os.Exit(1)
		}
		logger.Info("Migrations completed successfully")

	case "down":
		logger.Info("Rolling back last migration...")
		if err := Rollback(database); err != nil {
			logger.Info("Rollback failed: %v", err)
			os.Exit(1)
		}
		logger.Info("Rollback completed successfully")

	default:
		logger.Info("Unknown command. Use 'up' or 'down'", "command", *cmd)
	}
}
