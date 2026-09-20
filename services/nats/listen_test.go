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
