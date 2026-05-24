package logging

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"testing"
	"time"
)

func TestErrorAttributeSerializesAsString(t *testing.T) {
	buf := &bytes.Buffer{}
	handler := &canonicalHandler{
		writer:  buf,
		level:   &slog.LevelVar{},
		service: "db",
		writeMu: &sync.Mutex{},
	}
	handler.level.Set(slog.LevelDebug)

	err := fmt.Errorf("badger open failed: %w", errors.New("Cannot acquire directory lock"))
	record := slog.NewRecord(
		time.Now(),
		slog.LevelError,
		"Service retry failed",
		0,
	)
	record.AddAttrs(
		slog.String("name", "badger"),
		slog.String("type", "database"),
		slog.Any("error", err),
	)

	if err := handler.Handle(t.Context(), record); err != nil {
		t.Fatalf("handle: %v", err)
	}

	var payload map[string]any
	if err := json.Unmarshal(buf.Bytes(), &payload); err != nil {
		t.Fatalf("unmarshal: %v\nraw: %s", err, buf.String())
	}

	metadata, ok := payload["metadata"].(map[string]any)
	if !ok {
		t.Fatalf("metadata missing: %v", payload)
	}

	errorVal, ok := metadata["error"]
	if !ok {
		t.Fatalf("error key missing in metadata: %v", metadata)
	}

	errorStr, ok := errorVal.(string)
	if !ok {
		t.Fatalf("error should be string, got %T: %#v", errorVal, errorVal)
	}
	if errorStr == "" || errorStr == "{}" {
		t.Fatalf("unexpected error string: %q", errorStr)
	}
}
