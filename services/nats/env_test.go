package main

import (
	"os"
	"path/filepath"
	"strings"
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

// writeFile writes content to dir/name and returns the path.
func writeFile(t *testing.T, dir, name, content string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write %s: %v", name, err)
	}
	return path
}

// isolateLocation clears the location variables and moves to a working directory with no config
// file above it, so only what a test sets is found.
func isolateLocation(t *testing.T) {
	t.Helper()
	t.Setenv(configFileEnv, "")
	t.Setenv(rootDirEnv, "")
	t.Setenv("WOOFX3_MESSAGEBUS_WEBSOCKET_PORT", "")
	t.Chdir(t.TempDir())
}

func TestWoofx3ConfigNamesTheConfigFile(t *testing.T) {
	isolateLocation(t)
	dir := t.TempDir()
	path := writeFile(t, dir, "engine.json", `{"messagebusWebSocketPort": 4301}`)
	writeFile(t, dir, ".env", "WOOFX3_MESSAGEBUS_HOST=10.0.0.1\n")
	t.Setenv(configFileEnv, path)

	cfg, err := LoadConfig("")
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}

	if cfg.WebSocketPort != 4301 {
		t.Errorf("websocket port = %d, want 4301 from the WOOFX3_CONFIG file", cfg.WebSocketPort)
	}
	if cfg.Host != "10.0.0.1" {
		t.Errorf("host = %q, want 10.0.0.1 from the .env beside the WOOFX3_CONFIG file", cfg.Host)
	}
}

func TestAMissingWoofx3ConfigFileIsAnError(t *testing.T) {
	isolateLocation(t)
	t.Setenv(configFileEnv, filepath.Join(t.TempDir(), "missing.json"))

	if _, err := LoadConfig(""); err == nil {
		t.Fatal("LoadConfig accepted a WOOFX3_CONFIG naming a missing file")
	}
}

func TestWoofx3RootNamesTheConfigRoot(t *testing.T) {
	isolateLocation(t)
	root := t.TempDir()
	writeFile(t, root, ".woofx3.json", `{"messagebusWebSocketPort": 4302}`)
	t.Setenv(rootDirEnv, root)

	cfg, err := LoadConfig("")
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}

	if cfg.WebSocketPort != 4302 {
		t.Errorf("websocket port = %d, want 4302 from the file under WOOFX3_ROOT", cfg.WebSocketPort)
	}
}

func TestTheConfFlagWinsOverTheLocationVariables(t *testing.T) {
	isolateLocation(t)
	flagged := writeFile(t, t.TempDir(), ".woofx3.json", `{"messagebusWebSocketPort": 4303}`)
	root := t.TempDir()
	writeFile(t, root, ".woofx3.json", `{"messagebusWebSocketPort": 4304}`)
	t.Setenv(rootDirEnv, root)
	t.Setenv(configFileEnv, filepath.Join(root, ".woofx3.json"))

	cfg, err := LoadConfig(flagged)
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}

	if cfg.WebSocketPort != 4303 {
		t.Errorf("websocket port = %d, want 4303 from the -conf file", cfg.WebSocketPort)
	}
}

func TestAWoofx3RootWithoutAConfigFileIsConfiguredByVariablesOnly(t *testing.T) {
	isolateLocation(t)
	t.Setenv(rootDirEnv, t.TempDir())

	location, err := resolveConfigLocation("")
	if err != nil {
		t.Fatalf("resolveConfigLocation: %v", err)
	}

	if location.configPath != "" || !location.final {
		t.Errorf("location = %+v, want no config file and no executable-directory fallback", location)
	}
}

func TestWithoutLocationVariablesTheConfigIsFoundAboveTheWorkingDirectory(t *testing.T) {
	isolateLocation(t)
	root := t.TempDir()
	path := writeFile(t, root, ".woofx3.json", `{"messagebusWebSocketPort": 4305}`)
	nested := filepath.Join(root, "bin")
	if err := os.Mkdir(nested, 0o700); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	t.Chdir(nested)

	location, err := resolveConfigLocation("")
	if err != nil {
		t.Fatalf("resolveConfigLocation: %v", err)
	}
	if location.configPath != path || location.final {
		t.Errorf("location = %+v, want the parent's config file with the executable-directory fallback kept", location)
	}
}

func TestHardeningIsOffUnlessConfigured(t *testing.T) {
	cfg := DefaultConfiguration()
	if err := cfg.OverlayFromMap(map[string]string{}); err != nil {
		t.Fatalf("OverlayFromMap: %v", err)
	}

	if cfg.Token != "" || cfg.TCPDisabled || cfg.WebSocketSameOrigin || len(cfg.WebSocketAllowedOrigins) != 0 {
		t.Fatalf("hardening = %+v, want all of it off", cfg)
	}
}

func TestHardeningIsReadFromTheConfigFile(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, ".woofx3.json")
	config := `{
		"messagebusToken": "s3cret",
		"messagebusTcpDisabled": true,
		"messagebusWebsocketSameOrigin": "true",
		"messagebusWebsocketAllowedOrigins": "http://127.0.0.1:5173, https://app.example"
	}`
	if err := os.WriteFile(path, []byte(config), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	cfg, err := LoadConfig(path)
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}

	if cfg.Token != "s3cret" {
		t.Errorf("token = %q, want s3cret", cfg.Token)
	}
	if !cfg.TCPDisabled {
		t.Error("TCP listener enabled, want disabled")
	}
	if !cfg.WebSocketSameOrigin {
		t.Error("same-origin check off, want on")
	}
	want := []string{"http://127.0.0.1:5173", "https://app.example"}
	if strings.Join(cfg.WebSocketAllowedOrigins, " ") != strings.Join(want, " ") {
		t.Errorf("allowed origins = %q, want %q", cfg.WebSocketAllowedOrigins, want)
	}
}

func TestTheEnvironmentSetsTheToken(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, ".woofx3.json")
	if err := os.WriteFile(path, []byte(`{"messagebusToken": "from-file"}`), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	t.Setenv("WOOFX3_MESSAGEBUS_TOKEN", "from-env")

	cfg, err := LoadConfig(path)
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}

	if cfg.Token != "from-env" {
		t.Fatalf("token = %q, want the environment's", cfg.Token)
	}
}

func TestAnUnreadableHardeningFlagFailsTheLoad(t *testing.T) {
	cfg := DefaultConfiguration()
	err := cfg.OverlayFromMap(map[string]string{"WOOFX3_MESSAGEBUS_TCP_DISABLED": "yes please"})

	if err == nil {
		t.Fatal("OverlayFromMap accepted a flag it cannot parse")
	}
}
