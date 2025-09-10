package internal

import (
	"context"
	"log/slog"
	"time"

	"gorm.io/gorm/logger"
)

type SlogAdapter struct {
	slogger  *slog.Logger
	config   logger.Config
	logLevel logger.LogLevel
}

func NewSlogAdapter(slogger *slog.Logger, config logger.Config) *SlogAdapter {
	return &SlogAdapter{
		slogger:  slogger,
		config:   config,
		logLevel: config.LogLevel,
	}
}

func (l *SlogAdapter) LogMode(level logger.LogLevel) logger.Interface {
	newLogger := *l
	newLogger.logLevel = level
	return &newLogger
}

func (l *SlogAdapter) Info(ctx context.Context, msg string, args ...interface{}) {
	if l.logLevel >= logger.Info {
		l.slogger.Info(msg, "args", args)
	}
}

func (l *SlogAdapter) Warn(ctx context.Context, msg string, args ...interface{}) {
	if l.logLevel >= logger.Warn {
		l.slogger.Warn(msg, "args", args)
	}
}

func (l *SlogAdapter) Error(ctx context.Context, msg string, args ...interface{}) {
	if l.logLevel >= logger.Error {
		l.slogger.Error(msg, "args", args)
	}
}

func (l *SlogAdapter) Trace(ctx context.Context, begin time.Time, fc func() (sql string, rowsAffected int64), err error) {
	if l.logLevel <= logger.Silent {
		return
	}

	elapsed := time.Since(begin)
	sql, rows := fc()

	// For slow queries
	if l.config.SlowThreshold != 0 && elapsed > l.config.SlowThreshold && l.logLevel >= logger.Warn {
		l.slogger.Warn("SLOW SQL",
			"elapsed", elapsed.Milliseconds(),
			"rows", rows,
			"sql", sql,
			"error", err,
		)
		return
	}

	// For errors
	if err != nil && l.logLevel >= logger.Error {
		l.slogger.Error("SQL ERROR",
			"elapsed", elapsed.Milliseconds(),
			"rows", rows,
			"sql", sql,
			"error", err,
		)
		return
	}

	// For debug level
	if l.logLevel >= logger.Info {
		l.slogger.Debug("SQL",
			"elapsed", elapsed.Milliseconds(),
			"rows", rows,
			"sql", sql,
		)
	}
}
