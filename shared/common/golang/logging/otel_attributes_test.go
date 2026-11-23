package logging

import (
	"context"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
)

func TestParseKeyValueList(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		secret  bool
		want    map[string]string
		wantErr string
	}{
		{name: "empty", raw: "", want: map[string]string{}},
		{name: "whitespace only", raw: "  ", want: map[string]string{}},
		{name: "trims", raw: " a = 1 , b=2 ", want: map[string]string{"a": "1", "b": "2"}},
		{name: "empty segments ignored", raw: ",a=1,, ,b=2,", want: map[string]string{"a": "1", "b": "2"}},
		{name: "first equals splits", raw: "a=b=c", want: map[string]string{"a": "b=c"}},
		{name: "empty value allowed", raw: "a=", want: map[string]string{"a": ""}},
		{name: "later duplicate wins", raw: "a=1,a=2", want: map[string]string{"a": "2"}},
		{name: "no equals", raw: "a=1,oops", wantErr: `"oops"`},
		{name: "empty key", raw: " =v", wantErr: `"=v"`},
		{name: "secret no equals hides entry", raw: "topsecret", secret: true, wantErr: "entry 1"},
		{name: "secret empty key hides value", raw: "=hunter2", secret: true, wantErr: "entry 1"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseKeyValueList(tt.raw, "SRC", tt.secret)
			if tt.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
					t.Fatalf("error = %v, want containing %q", err, tt.wantErr)
				}
				if tt.secret && strings.Contains(err.Error(), strings.TrimPrefix(tt.raw, "=")) {
					t.Fatalf("secret leaked in error: %v", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("got %v, want %v", got, tt.want)
			}
		})
	}
}

func TestResolveConfigOTelAttributesAndHeaders(t *testing.T) {
	t.Run("env used and header name redacted", func(t *testing.T) {
		t.Setenv(envOTelResourceAttrs, "a=1")
		t.Setenv(envOTelExporterHeaders, "X-Key=s3cret")
		resolved, err := resolveConfig(Config{ServiceName: "test"})
		if err != nil {
			t.Fatal(err)
		}
		if resolved.OTelResourceAttributes["a"] != "1" || resolved.OTelExporterHeaders["X-Key"] != "s3cret" {
			t.Fatalf("env not applied: %+v", resolved)
		}
		if _, ok := resolved.RedactKeys["x-key"]; !ok {
			t.Fatal("header name must be redacted")
		}
	})
	t.Run("field beats env", func(t *testing.T) {
		t.Setenv(envOTelResourceAttrs, "a=env")
		resolved, err := resolveConfig(Config{ServiceName: "test", OTelResourceAttributes: "a=field"})
		if err != nil {
			t.Fatal(err)
		}
		if resolved.OTelResourceAttributes["a"] != "field" {
			t.Fatalf("got %v", resolved.OTelResourceAttributes)
		}
	})
	t.Run("malformed attribute fails", func(t *testing.T) {
		if _, err := resolveConfig(Config{ServiceName: "test", OTelResourceAttributes: "novalue"}); err == nil {
			t.Fatal("expected error")
		}
	})
	t.Run("malformed header fails without value", func(t *testing.T) {
		_, err := resolveConfig(Config{ServiceName: "test", OTelExporterHeaders: "=hunter2"})
		if err == nil || strings.Contains(err.Error(), "hunter2") {
			t.Fatalf("error = %v", err)
		}
	})
	t.Run("version from env", func(t *testing.T) {
		t.Setenv(envVersion, " 1.2.3 ")
		resolved, err := resolveConfig(Config{ServiceName: "test"})
		if err != nil {
			t.Fatal(err)
		}
		if resolved.ServiceVersion != "1.2.3" {
			t.Fatalf("version = %q", resolved.ServiceVersion)
		}
	})
}

func TestNewOTelResource(t *testing.T) {
	tests := []struct {
		name        string
		resolved    resolvedConfig
		wantName    string
		wantVersion string
		wantAttr    string
	}{
		{name: "plain", resolved: resolvedConfig{ServiceName: "svc"}, wantName: "svc"},
		{name: "attributes merged", resolved: resolvedConfig{ServiceName: "svc", OTelResourceAttributes: map[string]string{"env": "prod"}}, wantName: "svc", wantAttr: "prod"},
		{name: "service.name cannot be overridden", resolved: resolvedConfig{ServiceName: "svc", OTelResourceAttributes: map[string]string{"service.name": "evil"}}, wantName: "svc"},
		{name: "version set", resolved: resolvedConfig{ServiceName: "svc", ServiceVersion: "1.2.3"}, wantName: "svc", wantVersion: "1.2.3"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			res := newOTelResource(tt.resolved)
			got := map[string]string{}
			for _, kv := range res.Attributes() {
				got[string(kv.Key)] = kv.Value.Emit()
			}
			if got["service.name"] != tt.wantName || got["service.version"] != tt.wantVersion || got["env"] != tt.wantAttr {
				t.Fatalf("attributes = %v", got)
			}
		})
	}
}

func TestExportersSendHeaders(t *testing.T) {
	var mu sync.Mutex
	seen := map[string]string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		seen[r.URL.Path] = r.Header.Get("X-Test-Key")
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	enabled := true
	logger, err := New(Config{
		ServiceName:          "hdr",
		LogDirectory:         t.TempDir(),
		OTelEnabled:          &enabled,
		OTelTracingEnabled:   &enabled,
		OTelExporterEndpoint: server.URL,
		OTelExporterHeaders:  "X-Test-Key=abc",
	})
	if err != nil {
		t.Fatal(err)
	}
	_, span := StartSpan(context.Background(), "op")
	span.End()
	logger.Info("hello")
	if err := logger.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	mu.Lock()
	defer mu.Unlock()
	for _, path := range []string{otlpLogsPath, otlpTracesPath} {
		if seen[path] != "abc" {
			t.Fatalf("%s header = %q, seen %v", path, seen[path], seen)
		}
	}
}
