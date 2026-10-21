package main

import (
	"bufio"
	"context"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/nats-io/nats.go"
	natsclient "github.com/wolfymaster/woofx3/clients/nats"
)

// testToken passes config.ValidateSecret, as the server requires at startup.
const testToken = "integration-s3cret-0123456789abcdef"

// freePort returns a loopback port nothing is listening on.
func freePort(t *testing.T) int {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port
}

// startHardenedServer runs the server with every opt-in hardening setting on
// and returns its WebSocket URL.
func startHardenedServer(t *testing.T) string {
	t.Helper()
	cfg := DefaultConfiguration()
	cfg.Token = testToken
	cfg.TCPDisabled = true
	cfg.WebSocketSameOrigin = true
	cfg.WebSocketPort = freePort(t)

	ns, err := createServer(cfg, slog.Default())
	if err != nil {
		t.Fatalf("createServer: %v", err)
	}
	t.Cleanup(ns.Shutdown)

	if ns.Addr() != nil {
		t.Fatalf("TCP listener on %v, want none", ns.Addr())
	}
	return fmt.Sprintf("ws://%s:%d", cfg.Host, cfg.WebSocketPort)
}

func repoRoot(t *testing.T) string {
	t.Helper()
	root, err := filepath.Abs("../..")
	if err != nil {
		t.Fatalf("repo root: %v", err)
	}
	return root
}

// TestEveryClientAuthenticates starts the server with a token, TCP disabled
// and the WebSocket same-origin check on, then connects each language's
// client the way the engine's services do. The TypeScript client needs bun
// and the package's node_modules; the Rust one runs only when
// WOOFX3_NATS_RUST_INTEGRATION=1, since it builds barkloader.
func TestEveryClientAuthenticates(t *testing.T) {
	url := startHardenedServer(t)

	t.Run("go", func(t *testing.T) {
		// Over WebSocket the server answers a missing token by closing the
		// socket, so the client sees EOF rather than the authorization error.
		if anonymous, err := nats.Connect(url, nats.NoReconnect()); err == nil {
			anonymous.Close()
			t.Fatal("a client without the token was admitted")
		}
		if wrong, err := nats.Connect(url, nats.NoReconnect(), nats.Token("wrong")); err == nil {
			wrong.Close()
			t.Fatal("a client with the wrong token was admitted")
		}

		client, err := natsclient.CreateMessageBus(natsclient.Config{URL: url, Name: "auth-test", Token: testToken}, nil)
		if err != nil {
			t.Fatalf("connect with the token: %v", err)
		}
		defer client.Close()
		if err := client.AsNATS().Flush(); err != nil {
			t.Fatalf("flush: %v", err)
		}
	})

	t.Run("typescript", func(t *testing.T) {
		bun, err := exec.LookPath("bun")
		if err != nil {
			t.Skip("bun is not on PATH")
		}
		pkg := filepath.Join(repoRoot(t), "shared/clients/typescript/nats")
		if _, err := os.Stat(filepath.Join(pkg, "node_modules/@nats-io/nats-core")); err != nil {
			t.Skipf("%s has no node_modules; run bun install there", pkg)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, bun, "test/token-probe.ts", url, testToken)
		cmd.Dir = pkg
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("token probe: %v\n%s", err, out)
		}
	})

	t.Run("rust", func(t *testing.T) {
		if os.Getenv("WOOFX3_NATS_RUST_INTEGRATION") != "1" {
			t.Skip("set WOOFX3_NATS_RUST_INTEGRATION=1 to build and run barkloader's client")
		}
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
		defer cancel()
		cmd := exec.CommandContext(ctx, "cargo", "test", "-p", "barkloader", "--locked",
			"services::nats::tests::a_live_bus_admits_only_the_token", "--", "--ignored", "--exact")
		cmd.Dir = filepath.Join(repoRoot(t), "barkloader")
		cmd.Env = append(os.Environ(),
			"WOOFX3_TEST_MESSAGEBUS_URL="+url,
			"WOOFX3_TEST_MESSAGEBUS_TOKEN="+testToken,
		)
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("cargo test: %v\n%s", err, out)
		}
		if !strings.Contains(string(out), "1 passed") {
			t.Fatalf("the live-bus test did not run:\n%s", out)
		}
	})
}

// upgradeStatus sends a WebSocket upgrade with the given Origin (none when
// blank) and returns the HTTP status the server answers with.
func upgradeStatus(t *testing.T, url, origin string) int {
	t.Helper()
	hostPort := strings.TrimPrefix(url, "ws://")
	conn, err := net.DialTimeout("tcp", hostPort, 5*time.Second)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))

	request := "GET / HTTP/1.1\r\n" +
		"Host: " + hostPort + "\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
		"Sec-WebSocket-Version: 13\r\n"
	if origin != "" {
		request += "Origin: " + origin + "\r\n"
	}
	if _, err := conn.Write([]byte(request + "\r\n")); err != nil {
		t.Fatalf("write upgrade: %v", err)
	}
	resp, err := http.ReadResponse(bufio.NewReader(conn), nil)
	if err != nil {
		t.Fatalf("read upgrade response: %v", err)
	}
	return resp.StatusCode
}

// TestSameOriginTurnsAwayOtherPages is the reason for the setting: a browser
// always sends the Origin of the page that opened the socket, so a page on
// another site cannot reach the bus, while the engine's clients, which send
// no Origin, still can.
func TestSameOriginTurnsAwayOtherPages(t *testing.T) {
	url := startHardenedServer(t)
	self := "http://" + strings.TrimPrefix(url, "ws://")

	cases := []struct {
		origin string
		want   int
	}{
		{origin: "", want: http.StatusSwitchingProtocols},
		{origin: self, want: http.StatusSwitchingProtocols},
		{origin: "https://attacker.example", want: http.StatusForbidden},
		{origin: "http://localhost:5173", want: http.StatusForbidden},
	}
	for _, c := range cases {
		if got := upgradeStatus(t, url, c.origin); got != c.want {
			t.Errorf("Origin %q: status %d, want %d", c.origin, got, c.want)
		}
	}
}

// TestTheDefaultConfigurationTurnsAwayOtherPages runs the configuration a
// deployment gets when it sets nothing: the origin check must already be on.
func TestTheDefaultConfigurationTurnsAwayOtherPages(t *testing.T) {
	cfg := DefaultConfiguration()
	cfg.Port = -1
	cfg.WebSocketPort = freePort(t)
	ns, err := createServer(cfg, slog.Default())
	if err != nil {
		t.Fatalf("createServer: %v", err)
	}
	defer ns.Shutdown()
	url := fmt.Sprintf("ws://%s:%d", cfg.Host, cfg.WebSocketPort)

	cases := []struct {
		origin string
		want   int
	}{
		{origin: "", want: http.StatusSwitchingProtocols},
		{origin: "https://attacker.example", want: http.StatusForbidden},
		{origin: "http://localhost:5173", want: http.StatusForbidden},
	}
	for _, c := range cases {
		if got := upgradeStatus(t, url, c.origin); got != c.want {
			t.Errorf("Origin %q: status %d, want %d", c.origin, got, c.want)
		}
	}
}

func TestAnOpenServerAdmitsAnyone(t *testing.T) {
	cfg := DefaultConfiguration()
	cfg.WebSocketSameOrigin = false
	cfg.Port = -1
	cfg.WebSocketPort = freePort(t)
	wsPort := cfg.WebSocketPort
	ns, err := createServer(cfg, slog.Default())
	if err != nil {
		t.Fatalf("createServer: %v", err)
	}
	defer ns.Shutdown()

	if ns.Addr() == nil {
		t.Fatal("no TCP listener, want one by default")
	}
	for _, url := range []string{fmt.Sprintf("ws://%s:%d", cfg.Host, wsPort), "nats://" + ns.Addr().String()} {
		conn, err := nats.Connect(url, nats.NoReconnect())
		if err != nil {
			t.Fatalf("anonymous connect to %s: %v", url, err)
		}
		conn.Close()
	}
	if got := upgradeStatus(t, fmt.Sprintf("ws://%s:%d", cfg.Host, wsPort), "https://attacker.example"); got != http.StatusSwitchingProtocols {
		t.Fatalf("cross-origin upgrade: status %d, want %d with the origin check off", got, http.StatusSwitchingProtocols)
	}
}
