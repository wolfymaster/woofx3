package logging

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

func TestFileTransportWritesSingleLine(t *testing.T) {
	tempDir := t.TempDir()
	logger, err := New(Config{
		ServiceName:         "workflow",
		LogDirectory:        tempDir,
		EnableFileTransport: true,
	})
	if err != nil {
		t.Fatalf("new logger: %v", err)
	}
	defer logger.Close()

	logger.Info("hello", "user", "wolfy")

	logFilePath := mustFindServiceLogFile(t, tempDir, "workflow")
	content, err := os.ReadFile(logFilePath)
	if err != nil {
		t.Fatalf("read log file: %v", err)
	}

	lines := strings.Split(strings.TrimSpace(string(content)), "\n")
	if len(lines) != 1 {
		t.Fatalf("expected one line, got %d", len(lines))
	}

	var payload map[string]any
	if err := json.Unmarshal([]byte(lines[0]), &payload); err != nil {
		t.Fatalf("invalid json line: %v", err)
	}
	if payload["service"] != "workflow" {
		t.Fatalf("service mismatch: %v", payload["service"])
	}
}

func TestRedactionAppliedAcrossTransports(t *testing.T) {
	tempDir := t.TempDir()
	terminalBuffer := &bytes.Buffer{}

	logger, err := NewWithTransports(Config{
		ServiceName:             "db",
		LogDirectory:            tempDir,
		EnableFileTransport:     true,
		EnableTerminalTransport: true,
	}, []Transport{
		NewTerminalJSONTransportWithWriter(terminalBuffer),
		NewFileLineTransport(),
	})
	if err != nil {
		t.Fatalf("new logger: %v", err)
	}
	defer logger.Close()

	logger.Error("auth failed", "token", "secret-token", "metadata", map[string]any{"password": "abc"})

	terminalPayload := decodeLastJSONRecord(t, terminalBuffer.Bytes())
	assertRedacted(t, terminalPayload)

	logFilePath := mustFindServiceLogFile(t, tempDir, "db")
	content, err := os.ReadFile(logFilePath)
	if err != nil {
		t.Fatalf("read file log: %v", err)
	}
	filePayload := decodeLastJSONRecord(t, content)
	assertRedacted(t, filePayload)
}

func TestConfigPrecedence(t *testing.T) {
	t.Setenv("WOOFX3_LOG_LEVEL", "ERROR")
	t.Setenv("WOOFX3_LOG_DIR", "/tmp/from-env")
	t.Setenv("WOOFX3_LOG_ALLOW_RUNTIME_LEVEL", "true")

	resolved, err := resolveConfig(Config{
		ServiceName:  "api",
		Level:        slog.LevelDebug,
		LogDirectory: "/tmp/from-config",
	})
	if err != nil {
		t.Fatalf("resolve config: %v", err)
	}

	if resolved.Level != slog.LevelDebug {
		t.Fatalf("expected config level override, got %v", resolved.Level)
	}
	if resolved.LogDirectory != "/tmp/from-config" {
		t.Fatalf("expected config dir override, got %s", resolved.LogDirectory)
	}
	if !resolved.AllowRuntimeLevelChange {
		t.Fatalf("expected runtime level enabled from env")
	}
}

func TestSetLevelGetLevel(t *testing.T) {
	logger, err := New(Config{
		ServiceName:             "api",
		EnableFileTransport:     false,
		EnableTerminalTransport: false,
		AllowRuntimeLevelChange: true,
	})
	if err != nil {
		t.Fatalf("new logger: %v", err)
	}

	if logger.GetLevel() != slog.LevelInfo {
		t.Fatalf("unexpected default level: %v", logger.GetLevel())
	}

	if err := logger.SetLevel(slog.LevelDebug); err != nil {
		t.Fatalf("set level failed: %v", err)
	}
	if logger.GetLevel() != slog.LevelDebug {
		t.Fatalf("level not updated: %v", logger.GetLevel())
	}
}

func TestChildWithContextInheritanceAndOverride(t *testing.T) {
	buf := &bytes.Buffer{}
	logger, err := NewWithTransports(Config{
		ServiceName:             "workflow",
		EnableFileTransport:     false,
		EnableTerminalTransport: true,
	}, []Transport{
		NewTerminalJSONTransportWithWriter(buf),
	})
	if err != nil {
		t.Fatalf("new logger: %v", err)
	}

	parent := logger.WithContext(map[string]any{
		"traceId": "trace-parent",
		"userId":  "u1",
	})
	child := parent.Child(map[string]any{
		"userId": "u2",
		"spanId": "span-1",
	})
	child.Info("child-log")

	payload := decodeLastJSONRecord(t, buf.Bytes())
	if payload["traceId"] != "trace-parent" {
		t.Fatalf("traceId should inherit from parent, got %v", payload["traceId"])
	}
	if payload["spanId"] != "span-1" {
		t.Fatalf("spanId should come from child, got %v", payload["spanId"])
	}

	metadata, _ := payload["metadata"].(map[string]any)
	if metadata["userId"] != "u2" {
		t.Fatalf("child should override parent metadata key, got %v", metadata["userId"])
	}
}

func TestCustomTransportSmoke(t *testing.T) {
	transport := &noopTransport{}
	logger, err := NewWithTransports(Config{
		ServiceName:             "custom",
		EnableFileTransport:     false,
		EnableTerminalTransport: false,
	}, []Transport{transport})
	if err != nil {
		t.Fatalf("new logger: %v", err)
	}
	logger.Info("custom transport")
	if transport.handled == 0 {
		t.Fatalf("expected custom transport to receive records")
	}
}

func assertRedacted(t *testing.T, payload map[string]any) {
	t.Helper()
	metadata, _ := payload["metadata"].(map[string]any)
	if metadata["token"] != "[REDACTED]" {
		t.Fatalf("token not redacted: %v", metadata["token"])
	}
	nested, _ := metadata["metadata"].(map[string]any)
	if nested["password"] != "[REDACTED]" {
		t.Fatalf("password not redacted: %v", nested["password"])
	}
}

func decodeLastJSONRecord(t *testing.T, raw []byte) map[string]any {
	t.Helper()
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 {
		t.Fatalf("no log output")
	}

	lines := bytes.Split(raw, []byte("\n"))
	candidate := lines[len(lines)-1]
	if candidate[0] != '{' {
		// pretty JSON output; join all lines and decode.
		candidate = raw
	}

	payload := map[string]any{}
	if err := json.Unmarshal(candidate, &payload); err != nil {
		t.Fatalf("failed to decode log payload: %v", err)
	}
	return payload
}

func mustFindServiceLogFile(t *testing.T, dir string, serviceName string) string {
	t.Helper()

	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read log directory: %v", err)
	}

	pattern := regexp.MustCompile("^" + regexp.QuoteMeta(serviceName) + `_[0-9]{8}_[0-9]{4}\.log$`)
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if pattern.MatchString(entry.Name()) {
			return filepath.Join(dir, entry.Name())
		}
	}

	t.Fatalf("missing log file matching pattern for service %q", serviceName)
	return ""
}

type noopTransport struct {
	handled int
}

func (t *noopTransport) Name() string {
	return "noop"
}

func (t *noopTransport) Build(_ resolvedConfig, level *slog.LevelVar) (slog.Handler, io.Closer, error) {
	return &noopHandler{level: level, transport: t}, nil, nil
}

type noopHandler struct {
	level     *slog.LevelVar
	transport *noopTransport
}

func (h *noopHandler) Enabled(_ context.Context, level slog.Level) bool {
	return level >= h.level.Level()
}

func (h *noopHandler) Handle(_ context.Context, _ slog.Record) error {
	h.transport.handled++
	return nil
}

func (h *noopHandler) WithAttrs(_ []slog.Attr) slog.Handler { return h }
func (h *noopHandler) WithGroup(_ string) slog.Handler      { return h }
