package database

import (
	"context"
	"log/slog"
	"time"

	"gorm.io/gorm/logger"
)

// NewSlogAdapter returns a GORM logger.Interface using a slog.Logger
func NewSlogAdapter(slogger *slog.Logger, config logger.Config) logger.Interface {
	return &SlogAdapter{
		slogger: slogger,
		config:  config,
	}
}

// SlogAdapter implements gorm/logger.Interface using slog.Logger.
type SlogAdapter struct {
	slogger *slog.Logger
	config  logger.Config
}

// LogMode sets the log level and returns itself.
func (a *SlogAdapter) LogMode(level logger.LogLevel) logger.Interface {
	a.config.LogLevel = level
	return a
}

// Info logs info level messages if enabled.
func (a *SlogAdapter) Info(ctx context.Context, msg string, args ...interface{}) {
	if a.config.LogLevel >= logger.Info {
		a.slogger.InfoContext(ctx, msg, "args", args)
	}
}

// Warn logs warn level messages if enabled.
func (a *SlogAdapter) Warn(ctx context.Context, msg string, args ...interface{}) {
	if a.config.LogLevel >= logger.Warn {
		a.slogger.WarnContext(ctx, msg, "args", args)
	}
}

// Error logs error level messages if enabled.
func (a *SlogAdapter) Error(ctx context.Context, msg string, args ...interface{}) {
	if a.config.LogLevel >= logger.Error {
		a.slogger.ErrorContext(ctx, msg, "args", args)
	}
}

// Trace logs SQL query information, execution time, errors, and affected rows.
func (a *SlogAdapter) Trace(ctx context.Context, begin time.Time, fc func() (string, int64), err error) {
	elapsed := time.Since(begin)
	sql, rows := fc()

	// Log as error if an error occurred (and not ignored), else warn if slow, else info
	switch {
	case err != nil:
		a.slogger.ErrorContext(ctx, "gorm trace",
			"err", err,
			"elapsed_ms", float64(elapsed.Microseconds())/1000.0,
			"rows", rows,
			"sql", sql,
		)
	case a.config.SlowThreshold != 0 && elapsed > a.config.SlowThreshold:
		a.slogger.WarnContext(ctx, "gorm trace (slow)",
			"elapsed_ms", float64(elapsed.Microseconds())/1000.0,
			"rows", rows,
			"sql", sql,
		)
		// case a.config.LogLevel >= logger.Info:
		// 	a.slogger.InfoContext(ctx, "gorm trace",
		// 		"elapsed_ms", float64(elapsed.Microseconds())/1000.0,
		// 		"rows", rows,
		// 		"sql", sql,
		// 	)
	}
}
