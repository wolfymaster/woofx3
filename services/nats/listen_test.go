package main

import (
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

	ns, err := createServer(cfg, slog.Default(), cfg.Host, -1)
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
