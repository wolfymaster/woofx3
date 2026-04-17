package logging

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"slices"
	"strings"
	"sync"
	"time"
)

var traceContextFields = map[string]struct{}{
	"applicationId": {},
	"instanceId":    {},
	"requestId":     {},
	"traceId":       {},
	"spanId":        {},
	"eventId":       {},
	"eventType":     {},
}

type canonicalHandler struct {
	writer     io.Writer
	level      *slog.LevelVar
	service    string
	pretty     bool
	redactKeys map[string]struct{}
	addSource  bool
	attrs      []slog.Attr
	groups     []string
	writeMu    *sync.Mutex
}

func (h *canonicalHandler) Enabled(_ context.Context, level slog.Level) bool {
	return level >= h.level.Level()
}

func (h *canonicalHandler) Handle(_ context.Context, record slog.Record) error {
	metadata := map[string]any{}
	for _, attr := range h.attrs {
		h.addToMetadata(metadata, attr, h.groups)
	}
	record.Attrs(func(attr slog.Attr) bool {
		h.addToMetadata(metadata, attr, h.groups)
		return true
	})

	topLevel := map[string]any{
		"timestamp": record.Time.UTC().Format(time.RFC3339Nano),
		"service":   h.service,
		"level":     strings.ToLower(record.Level.String()),
		"message":   record.Message,
	}

	if h.addSource && record.PC != 0 {
		frames := make([]uintptr, 1)
		frames[0] = record.PC
		fs := runtimeCallersFrames(frames)
		if len(fs) > 0 {
			topLevel["source"] = fs[0]
		}
	}

	for key := range traceContextFields {
		if value, ok := metadata[key]; ok {
			topLevel[key] = value
			delete(metadata, key)
		}
	}

	topLevel["metadata"] = redactAny(metadata, h.redactKeys)

	payloadBytes, err := marshalPayload(topLevel, h.pretty)
	if err != nil {
		return err
	}

	h.writeMu.Lock()
	defer h.writeMu.Unlock()
	_, err = h.writer.Write(payloadBytes)
	return err
}

func (h *canonicalHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	next := *h
	next.attrs = append(slices.Clone(h.attrs), attrs...)
	return &next
}

func (h *canonicalHandler) WithGroup(name string) slog.Handler {
	next := *h
	next.groups = append(slices.Clone(h.groups), name)
	return &next
}

func (h *canonicalHandler) addToMetadata(metadata map[string]any, attr slog.Attr, groups []string) {
	attr.Value = attr.Value.Resolve()
	if attr.Equal(slog.Attr{}) {
		return
	}
	value := valueToAny(attr.Value)
	if len(groups) == 0 {
		if attr.Key == "service" || attr.Key == "timestamp" || attr.Key == "level" || attr.Key == "message" {
			return
		}
		metadata[attr.Key] = value
		return
	}

	cursor := metadata
	for _, group := range groups {
		next, ok := cursor[group]
		if !ok {
			created := map[string]any{}
			cursor[group] = created
			cursor = created
			continue
		}
		asMap, ok := next.(map[string]any)
		if !ok {
			created := map[string]any{}
			cursor[group] = created
			cursor = created
			continue
		}
		cursor = asMap
	}
	cursor[attr.Key] = value
}

func marshalPayload(payload map[string]any, pretty bool) ([]byte, error) {
	var (
		b   []byte
		err error
	)
	if pretty {
		b, err = json.MarshalIndent(payload, "", "  ")
	} else {
		b, err = json.Marshal(payload)
	}
	if err != nil {
		return nil, err
	}
	return append(b, '\n'), nil
}

type fanoutHandler struct {
	handlers []slog.Handler
}

func (h *fanoutHandler) Enabled(ctx context.Context, level slog.Level) bool {
	for _, handler := range h.handlers {
		if handler.Enabled(ctx, level) {
			return true
		}
	}
	return false
}

func (h *fanoutHandler) Handle(ctx context.Context, record slog.Record) error {
	var errs []error
	for _, handler := range h.handlers {
		if !handler.Enabled(ctx, record.Level) {
			continue
		}
		if err := handler.Handle(ctx, record.Clone()); err != nil {
			errs = append(errs, err)
		}
	}
	if len(errs) == 0 {
		return nil
	}
	return errors.Join(errs...)
}

func (h *fanoutHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	next := make([]slog.Handler, 0, len(h.handlers))
	for _, handler := range h.handlers {
		next = append(next, handler.WithAttrs(attrs))
	}
	return &fanoutHandler{handlers: next}
}

func (h *fanoutHandler) WithGroup(name string) slog.Handler {
	next := make([]slog.Handler, 0, len(h.handlers))
	for _, handler := range h.handlers {
		next = append(next, handler.WithGroup(name))
	}
	return &fanoutHandler{handlers: next}
}
