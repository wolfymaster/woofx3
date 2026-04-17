package logging

import (
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type FileLineTransport struct{}

func NewFileLineTransport() *FileLineTransport {
	return &FileLineTransport{}
}

func (t *FileLineTransport) Name() string {
	return "file-line"
}

func (t *FileLineTransport) Build(resolved resolvedConfig, level *slog.LevelVar) (slog.Handler, io.Closer, error) {
	if !resolved.EnableFileTransport {
		return nil, nil, nil
	}

	if err := os.MkdirAll(resolved.LogDirectory, 0o755); err != nil {
		return nil, nil, fmt.Errorf("create log directory: %w", err)
	}

	filePath := filepath.Join(resolved.LogDirectory, makeLogFileName(resolved.ServiceName, time.Now()))
	logFile, err := os.OpenFile(filePath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return nil, nil, fmt.Errorf("open log file: %w", err)
	}

	handler := &canonicalHandler{
		writer:     logFile,
		level:      level,
		service:    resolved.ServiceName,
		pretty:     false,
		redactKeys: resolved.RedactKeys,
		addSource:  resolved.AddSource,
		writeMu:    &sync.Mutex{},
	}
	return handler, logFile, nil
}

func makeLogFileName(serviceName string, now time.Time) string {
	return fmt.Sprintf("%s_%s.log", serviceName, now.Format("20060102_1504"))
}
