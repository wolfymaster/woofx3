package main

import (
	"errors"
	"log/slog"
	"net"
	"testing"
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

func TestReachableWithoutToken(t *testing.T) {
	cases := []struct {
		host  string
		token string
		want  bool
	}{
		{host: "127.0.0.1", want: false},
		{host: "::1", want: false},
		{host: "localhost", want: false},
		{host: "0.0.0.0", want: true},
		{host: "192.168.1.20", want: true},
		{host: "nats.internal", want: true},
		{host: "0.0.0.0", token: "s3cret", want: false},
	}
	for _, tc := range cases {
		t.Run(tc.host+"/token="+tc.token, func(t *testing.T) {
			if got := reachableWithoutToken(tc.host, tc.token); got != tc.want {
				t.Errorf("reachableWithoutToken(%q, %q) = %v, want %v", tc.host, tc.token, got, tc.want)
			}
		})
	}
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
			cfg := DefaultConfiguration()
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
	cfg := DefaultConfiguration()
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
		{name: "a wildcard", origins: []string{"*"}, wantErr: ErrInvalidOrigin},
		{name: "one bad among good", origins: []string{"https://app.example", "nope"}, wantErr: ErrInvalidOrigin},
		{name: "a list with same-origin on", origins: []string{"https://app.example"}, sameOrigin: true, wantErr: ErrOriginsUnreachable},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cfg := DefaultConfiguration()
			cfg.WebSocketSameOrigin = tc.sameOrigin
			cfg.WebSocketAllowedOrigins = tc.origins
			if err := cfg.Validate(); !errors.Is(err, tc.wantErr) {
				t.Fatalf("Validate() = %v, want %v", err, tc.wantErr)
			}
		})
	}
}
