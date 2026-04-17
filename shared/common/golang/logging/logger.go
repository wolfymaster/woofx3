package logging

import (
	"fmt"
	"io"
	"log/slog"
)

type Logger struct {
	slogLogger              *slog.Logger
	level                   *slog.LevelVar
	allowRuntimeLevelChange bool
	defaultContext          Fields
	closers                 []io.Closer
}

func New(config Config) (*Logger, error) {
	return NewWithTransports(config, buildDefaultTransports())
}

func MakeLogger(config Config) (*Logger, error) {
	return New(config)
}

func NewWithTransports(config Config, transports []Transport) (*Logger, error) {
	resolved, err := resolveConfig(config)
	if err != nil {
		return nil, err
	}

	levelVar := &slog.LevelVar{}
	levelVar.Set(resolved.Level)

	handlers, closers, err := buildHandlers(resolved, levelVar, transports)
	if err != nil {
		return nil, err
	}

	handler := &fanoutHandler{handlers: handlers}
	baseSlog := slog.New(handler)

	baseSlog = baseSlog.With("service", resolved.ServiceName)

	return &Logger{
		slogLogger:              baseSlog,
		level:                   levelVar,
		allowRuntimeLevelChange: resolved.AllowRuntimeLevelChange,
		defaultContext:          Fields{},
		closers:                 closers,
	}, nil
}

func (l *Logger) Slog() *slog.Logger {
	return l.slogLogger
}

func (l *Logger) Info(message string, args ...any) {
	l.slogLogger.Info(message, args...)
}

func (l *Logger) Error(message string, args ...any) {
	l.slogLogger.Error(message, args...)
}

func (l *Logger) Warn(message string, args ...any) {
	l.slogLogger.Warn(message, args...)
}

func (l *Logger) Debug(message string, args ...any) {
	l.slogLogger.Debug(message, args...)
}

func (l *Logger) Child(fields map[string]any) *Logger {
	return l.WithContext(fields)
}

func (l *Logger) WithContext(fields map[string]any) *Logger {
	nextFields := cloneFields(l.defaultContext)
	for key, value := range fields {
		nextFields[key] = value
	}

	return &Logger{
		slogLogger:              l.slogLogger.With(fieldsToArgs(fields)...),
		level:                   l.level,
		allowRuntimeLevelChange: l.allowRuntimeLevelChange,
		defaultContext:          nextFields,
		closers:                 l.closers,
	}
}

func (l *Logger) SetLevel(level slog.Level) error {
	if !l.allowRuntimeLevelChange {
		return fmt.Errorf("runtime log level changes are disabled")
	}
	l.level.Set(level)
	return nil
}

func (l *Logger) GetLevel() slog.Level {
	return l.level.Level()
}

func (l *Logger) Close() error {
	var errs []error
	for _, closer := range l.closers {
		if err := closer.Close(); err != nil {
			errs = append(errs, err)
		}
	}
	if len(errs) == 0 {
		return nil
	}
	return fmt.Errorf("close logger resources: %v", errs)
}

func fieldsToArgs(fields map[string]any) []any {
	args := make([]any, 0, len(fields)*2)
	for key, value := range fields {
		args = append(args, key, value)
	}
	return args
}

func cloneFields(fields Fields) Fields {
	out := make(Fields, len(fields))
	for key, value := range fields {
		out[key] = value
	}
	return out
}
