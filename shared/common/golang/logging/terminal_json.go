package logging

import (
	"io"
	"log/slog"
	"os"
	"sync"
)

type TerminalJSONTransport struct {
	writer io.Writer
}

func NewTerminalJSONTransport() *TerminalJSONTransport {
	return &TerminalJSONTransport{writer: os.Stdout}
}

func NewTerminalJSONTransportWithWriter(writer io.Writer) *TerminalJSONTransport {
	return &TerminalJSONTransport{writer: writer}
}

func (t *TerminalJSONTransport) Name() string {
	return "terminal-json"
}

func (t *TerminalJSONTransport) Build(resolved resolvedConfig, level *slog.LevelVar) (slog.Handler, io.Closer, error) {
	if !resolved.EnableTerminalTransport {
		return nil, nil, nil
	}

	handler := &canonicalHandler{
		writer:     t.writer,
		level:      level,
		service:    resolved.ServiceName,
		pretty:     true,
		redactKeys: resolved.RedactKeys,
		addSource:  resolved.AddSource,
		writeMu:    &sync.Mutex{},
	}
	return handler, nil, nil
}
