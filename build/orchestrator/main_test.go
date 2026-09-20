package main

import (
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestAServiceIsLaunchedWithItsDeclaredArguments(t *testing.T) {
	service := Service{Name: "edge", Args: []string{"run", "--config", "Caddyfile.edge"}}

	got := serviceArgv("/app/caddy", service)

	want := []string{"/app/caddy", "run", "--config", "Caddyfile.edge"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("argv = %v, want %v", got, want)
	}
}

func TestAServiceWithoutArgumentsGetsOnlyItsPath(t *testing.T) {
	got := serviceArgv("/app/api", Service{Name: "api"})

	if !reflect.DeepEqual(got, []string{"/app/api"}) {
		t.Fatalf("argv = %v, want just the binary path", got)
	}
}

func TestAPrebuiltBinaryThatIsNotInstalledIsSkipped(t *testing.T) {
	baseDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(baseDir, "api"), []byte{}, 0o755); err != nil {
		t.Fatalf("write api: %v", err)
	}
	config := &Config{Services: []Service{
		{Name: "api", Type: "bun", Output: "api", Enabled: true},
		{Name: "edge", Type: "binary", Output: "caddy", Enabled: true},
		{Name: "off", Type: "bun", Output: "off", Enabled: false},
	}}

	got := servicesToRun(baseDir, config, discardLogger())

	names := make([]string, 0, len(got))
	for _, service := range got {
		names = append(names, service.Name)
	}
	if !reflect.DeepEqual(names, []string{"api"}) {
		t.Fatalf("services to run = %v, want [api]: an absent prebuilt binary is skipped", names)
	}
}

func TestAPrebuiltBinaryThatIsInstalledRuns(t *testing.T) {
	baseDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(baseDir, "caddy"), []byte{}, 0o755); err != nil {
		t.Fatalf("write caddy: %v", err)
	}
	config := &Config{Services: []Service{{Name: "edge", Type: "binary", Output: "caddy", Enabled: true}}}

	got := servicesToRun(baseDir, config, discardLogger())

	if len(got) != 1 || got[0].Name != "edge" {
		t.Fatalf("services to run = %v, want [edge]", got)
	}
}
