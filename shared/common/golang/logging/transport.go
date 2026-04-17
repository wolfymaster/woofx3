package logging

import (
	"fmt"
	"io"
	"log/slog"
)

type Transport interface {
	Name() string
	Build(resolved resolvedConfig, level *slog.LevelVar) (slog.Handler, io.Closer, error)
}

func buildDefaultTransports() []Transport {
	return []Transport{
		NewTerminalJSONTransport(),
		NewFileLineTransport(),
	}
}

func buildHandlers(
	resolved resolvedConfig,
	level *slog.LevelVar,
	transports []Transport,
) ([]slog.Handler, []io.Closer, error) {
	handlers := []slog.Handler{}
	closers := []io.Closer{}

	for _, transport := range transports {
		handler, closer, err := transport.Build(resolved, level)
		if err != nil {
			return nil, nil, fmt.Errorf("build transport %q: %w", transport.Name(), err)
		}
		if handler != nil {
			handlers = append(handlers, handler)
		}
		if closer != nil {
			closers = append(closers, closer)
		}
	}

	if len(handlers) == 0 {
		return nil, nil, fmt.Errorf("no logging transports enabled")
	}

	return handlers, closers, nil
}
