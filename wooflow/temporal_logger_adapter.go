package main

import (
        "log/slog"

        temporalLog "go.temporal.io/sdk/log"
)

// Ensure TemporalLoggerAdapter implements temporal's log.Logger interface
var _ temporalLog.Logger = (*TemporalLoggerAdapter)(nil)

// TemporalLoggerAdapter adapts slog.Logger to temporal's log.Logger interface
type TemporalLoggerAdapter struct {
        logger *slog.Logger
}

// Debug implements temporal log.Logger
func (t *TemporalLoggerAdapter) Debug(msg string, keyvals ...interface{}) {
        t.logger.Debug(msg, keyvals...)
}

// Info implements temporal log.Logger
func (t *TemporalLoggerAdapter) Info(msg string, keyvals ...interface{}) {
        t.logger.Info(msg, keyvals...)
}

// Warn implements temporal log.Logger
func (t *TemporalLoggerAdapter) Warn(msg string, keyvals ...interface{}) {
        t.logger.Warn(msg, keyvals...)
}

// Error implements temporal log.Logger
func (t *TemporalLoggerAdapter) Error(msg string, keyvals ...interface{}) {
        t.logger.Error(msg, keyvals...)
}