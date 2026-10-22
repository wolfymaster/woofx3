package main

import (
	"errors"
	"log/slog"
	"net"
	"path/filepath"
	"testing"

	"github.com/wolfymaster/woofx3/common/config"
)

func TestTheServerListensOnLoopbackByDefault(t *testing.T) {
	cfg := DefaultConfiguration()
	if cfg.Host != "127.0.0.1" {
		t.Fatalf("default host = %q, want 127.0.0.1: NATS has no auth", cfg.Host)
	}
	// -1 asks NATS for a free port, so the test never collides with a
	// running engine.
	cfg.Port = -1
	cfg.WebSocketPort = -1

	ns, err := createServer(cfg, slog.Default())
	if err != nil {
		t.Fatalf("createServer: %v", err)
	}
	defer ns.Shutdown()

	addr, ok := ns.Addr().(*net.TCPAddr)
	if !ok {
		t.Fatalf("client listener address = %v, want a TCP address", ns.Addr())
	}
	if !addr.IP.IsLoopback() {
		t.Fatalf("client listener bound %v, want loopback", addr.IP)
	}
}

func TestIsLoopbackHost(t *testing.T) {
	cases := []struct {
		host string
		want bool
	}{
		{host: "127.0.0.1", want: true},
		{host: "::1", want: true},
		{host: "localhost", want: true},
		{host: "0.0.0.0", want: false},
		{host: "192.168.1.20", want: false},
		{host: "nats.internal", want: false},
	}
	for _, tc := range cases {
		t.Run(tc.host, func(t *testing.T) {
			if got := isLoopbackHost(tc.host); got != tc.want {
				t.Errorf("isLoopbackHost(%q) = %v, want %v", tc.host, got, tc.want)
			}
		})
	}
}

// validConfiguration is the default configuration with the one setting it
// cannot start without.
func validConfiguration() *Configuration {
	cfg := DefaultConfiguration()
	cfg.Token = testToken
	return cfg
}

func TestValidateRefusesListenersOnOnePort(t *testing.T) {
	cases := []struct {
		name        string
		port        int
		wsPort      int
		tcpDisabled bool
		wantErr     error
	}{
		{name: "the defaults", port: DefaultClientPort, wsPort: DefaultWebSocketPort},
		{name: "one port for both", port: 4300, wsPort: 4300, wantErr: ErrPortsCollide},
		{name: "one port with TCP off", port: 4300, wsPort: 4300, tcpDisabled: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cfg := validConfiguration()
			cfg.Port = tc.port
			cfg.WebSocketPort = tc.wsPort
			cfg.TCPDisabled = tc.tcpDisabled
			if err := cfg.Validate(); !errors.Is(err, tc.wantErr) {
				t.Fatalf("Validate() = %v, want %v", err, tc.wantErr)
			}
		})
	}
}

func TestAPortOfZeroFailsValidation(t *testing.T) {
	cfg := validConfiguration()
	cfg.WebSocketPort = 0
	if err := cfg.Validate(); err == nil {
		t.Fatal("Validate accepted WebSocket port 0")
	}
}

// A blank messagebusHost, as a template ships it, means "not set" and keeps
// the loopback default: NATS would otherwise bind every interface.
func TestABlankHostStaysOnLoopback(t *testing.T) {
	cases := []struct {
		name   string
		config string
		env    string
	}{
		{name: "blank in the file", config: `{"messagebusHost": ""}`},
		{name: "blank in the file, spelt as the template does", config: `{"messageBusHost": ""}`},
		{name: "spaces in the file", config: `{"messagebusHost": "   "}`},
		{name: "null in the file", config: `{"messagebusHost": null}`},
		{name: "blank in the environment", config: `{}`, env: " "},
		{name: "blank everywhere", config: `{"messagebusHost": ""}`, env: ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			isolateLocation(t)
			t.Setenv("WOOFX3_MESSAGEBUS_HOST", tc.env)
			path := writeFile(t, t.TempDir(), ".woofx3.json", tc.config)

			cfg, err := LoadConfig(path)
			if err != nil {
				t.Fatalf("LoadConfig: %v", err)
			}
			if cfg.Host != DefaultHost {
				t.Fatalf("host = %q, want %q", cfg.Host, DefaultHost)
			}
		})
	}
}

func TestABlankFileValueKeepsEachDefault(t *testing.T) {
	isolateLocation(t)
	path := writeFile(t, t.TempDir(), ".woofx3.json", `{"messagebusHost": "", "logLevel": "", "messagebusWebSocketPort": 4301}`)

	cfg, err := LoadConfig(path)
	if err != nil {
		t.Fatalf("LoadConfig: %v", err)
	}
	if cfg.WebSocketPort != 4301 || cfg.Port != DefaultClientPort || cfg.Host != DefaultHost {
		t.Fatalf("config = %+v, want the file's WebSocket port and every other default", cfg)
	}
}

func TestValidateChecksTheAllowedOrigins(t *testing.T) {
	cases := []struct {
		name       string
		origins    []string
		sameOrigin bool
		wantErr    error
	}{
		{name: "none", sameOrigin: true},
		{name: "http and https with ports", origins: []string{"http://127.0.0.1:5173", "https://app.example", "http://[::1]:8080"}},
		{name: "a path", origins: []string{"https://app.example/"}, wantErr: ErrInvalidOrigin},
		{name: "no scheme", origins: []string{"app.example"}, wantErr: ErrInvalidOrigin},
		{name: "another scheme", origins: []string{"ws://app.example"}, wantErr: ErrInvalidOrigin},
		{name: "a query", origins: []string{"https://app.example?x=1"}, wantErr: ErrInvalidOrigin},
		{name: "user info", origins: []string{"https://user@app.example"}, wantErr: ErrInvalidOrigin},
		{name: "an empty port", origins: []string{"https://app.example:"}, wantErr: ErrInvalidOrigin},
		{name: "an upper-case scheme", origins: []string{"HTTPS://app.example"}, wantErr: ErrInvalidOrigin},
		{name: "a wildcard", origins: []string{"*"}, wantErr: ErrInvalidOrigin},
		{name: "one bad among good", origins: []string{"https://app.example", "nope"}, wantErr: ErrInvalidOrigin},
		{name: "a list with same-origin on", origins: []string{"https://app.example"}, sameOrigin: true, wantErr: ErrOriginsUnreachable},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cfg := validConfiguration()
			cfg.WebSocketSameOrigin = tc.sameOrigin
			cfg.WebSocketAllowedOrigins = tc.origins
			if err := cfg.Validate(); !errors.Is(err, tc.wantErr) {
				t.Fatalf("Validate() = %v, want %v", err, tc.wantErr)
			}
		})
	}
}

// TestStartupRequiresAToken loads each case the way main does, from a config
// file and the environment.
func TestStartupRequiresAToken(t *testing.T) {
	cases := []struct {
		name    string
		token   string
		optOut  string
		wantErr error
		wantAny bool
	}{
		{name: "a token", token: testToken},
		{name: "no token", wantErr: ErrNoToken},
		{name: "a blank token", token: "   ", wantErr: ErrNoToken},
		{name: "no token, opted out", optOut: "true"},
		{name: "no token, opt-out false", optOut: "false", wantErr: ErrNoToken},
		{name: "a token, opted out", token: testToken, optOut: "true"},
		{name: "a short token", token: "s3cret", wantErr: config.ErrSecretTooShort},
		{name: "a placeholder token", token: "CHANGE_ME", wantErr: config.ErrSecretPlaceholder},
		{name: "a short token, opted out", token: "s3cret", optOut: "true", wantErr: config.ErrSecretTooShort},
		{name: "opt-out garbage", optOut: "yes", wantAny: true},
		{name: "opt-out 1", optOut: "1", wantAny: true},
		{name: "opt-out in capitals", optOut: "TRUE", wantAny: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			isolateLocation(t)
			t.Setenv("WOOFX3_MESSAGEBUS_TOKEN", tc.token)
			t.Setenv("WOOFX3_MESSAGEBUS_ALLOW_UNAUTHENTICATED", tc.optOut)
			root := t.TempDir()
			path := writeFile(t, root, ".woofx3.json", `{"rootPath": "`+filepath.ToSlash(root)+`"}`)

			_, err := loadConfiguration(path)
			switch {
			case tc.wantAny:
				if err == nil {
					t.Fatalf("loadConfiguration accepted WOOFX3_MESSAGEBUS_ALLOW_UNAUTHENTICATED=%q", tc.optOut)
				}
			case !errors.Is(err, tc.wantErr):
				t.Fatalf("loadConfiguration() = %v, want %v", err, tc.wantErr)
			}
		})
	}
}

func TestTheOptOutIsReadFromTheConfigFile(t *testing.T) {
	isolateLocation(t)
	t.Setenv("WOOFX3_MESSAGEBUS_TOKEN", "")
	t.Setenv("WOOFX3_MESSAGEBUS_ALLOW_UNAUTHENTICATED", "")
	root := t.TempDir()
	path := writeFile(t, root, ".woofx3.json", `{"rootPath": "`+filepath.ToSlash(root)+`", "messagebusAllowUnauthenticated": true}`)

	cfg, err := loadConfiguration(path)
	if err != nil {
		t.Fatalf("loadConfiguration: %v", err)
	}
	if !cfg.AllowUnauthenticated {
		t.Fatal("messagebusAllowUnauthenticated: true in the file was not read")
	}
}
