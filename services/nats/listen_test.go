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

	ns, err := createServer(cfg, slog.Default(), cfg.Host)
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
