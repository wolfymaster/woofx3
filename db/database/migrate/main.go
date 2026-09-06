package main

import (
	"flag"
	"fmt"
	"os"
	"strings"

	"github.com/wolfymaster/woofx3/common/logging"
	"github.com/wolfymaster/woofx3/common/runtime"
	db "github.com/wolfymaster/woofx3/db/database"
)

func main() {
	env, err := runtime.LoadRuntimeEnv(nil)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to load runtime env: %v\n", err)
		os.Exit(1)
	}

	sharedLogger, err := logging.New(logging.Config{
		ServiceName:  "migrate",
		LogDirectory: strings.TrimSpace(env["WOOFX3_ROOT_PATH"]) + "/logs",
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to initialize logger: %v\n", err)
		os.Exit(1)
	}
	defer sharedLogger.Close()
	logger := sharedLogger.Slog()

	cmd := flag.String("cmd", "up", "migration command (up, down)")
	dbURL := flag.String("db", env["WOOFX3_DATABASE_URL"], "database connection string")
	flag.Parse()

	if *dbURL == "" {
		logger.Error("Database URL is required. Use -db flag, set WOOFX3_DATABASE_URL, or set databaseUrl in .woofx3.json")
		exit(sharedLogger, 1)
	}

	parsed, err := db.ParseDatabaseURL(*dbURL)
	if err != nil {
		logger.Error("Invalid database URL", "error", err)
		exit(sharedLogger, 1)
	}

	database, err := db.InitializeDB(*dbURL, logger)
	if err != nil {
		logger.Error("Failed to connect to database", "error", err)
		exit(sharedLogger, 1)
	}

	logger.Info("Selected migration dialect", "dialect", parsed.Dialect)

	switch *cmd {
	case "up":
		logger.Info("Running migrations...")
		if err := Migrate(database, parsed.Dialect); err != nil {
			logger.Error("Migration failed", "error", err)
			exit(sharedLogger, 1)
		}
		logger.Info("Migrations completed successfully")

	case "down":
		logger.Info("Rolling back last migration...")
		if err := Rollback(database, parsed.Dialect); err != nil {
			logger.Error("Rollback failed", "error", err)
			exit(sharedLogger, 1)
		}
		logger.Info("Rollback completed successfully")

	default:
		logger.Error("Unknown command. Use 'up' or 'down'", "command", *cmd)
		exit(sharedLogger, 1)
	}
}

// exit flushes the logger before terminating; os.Exit skips deferred closers,
// which would drop buffered file and OTLP records.
func exit(logger *logging.Logger, code int) {
	logger.Close()
	os.Exit(code)
}
