package main

import (
	"log/slog"
	"os"

	"github.com/wolfymaster/woofx3/common/logging"
)

func isDevelopment() bool {
	env := os.Getenv("GO_ENV")
	return env == "development" || env == "dev"
}

func parseLogLevel(lvl string) slog.Level {
	switch lvl {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	case "info", "":
		fallthrough
	default:
		return slog.LevelInfo
	}
}

// fatalExit reports a startup failure and terminates. os.Exit skips deferred
// closers, so the logger is flushed here before the process goes away.
func fatalExit(logger *logging.Logger, msg string, args ...any) {
	logger.Error(msg, args...)
	logger.Close()
	os.Exit(1)
}
