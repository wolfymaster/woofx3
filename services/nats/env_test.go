package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestTheEnvironmentOverridesTheConfigFile(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, ".woofx3.json")
	if err := os.WriteFile(path, []byte(`{"messagebusHost": "127.0.0.1", "messagebusWebSocketPort": 4225}`), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	t.Setenv("WOOFX3_MESSAGEBUS_HOST", "0.0.0.0")

	cfg, err := LoadConfig(path)
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}

	if cfg.Host != "0.0.0.0" {
		t.Fatalf("host = %q, want the environment's 0.0.0.0", cfg.Host)
	}
	if cfg.WebSocketPort != 4225 {
		t.Fatalf("websocket port = %d, want the file's 4225", cfg.WebSocketPort)
	}
}
