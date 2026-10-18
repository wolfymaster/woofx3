package nats

import (
	"bufio"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"
)

// captureConnect accepts one connection, tells the client that auth is
// required, and returns the options the client sent in its CONNECT.
func captureConnect(t *testing.T) (string, <-chan map[string]any) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	t.Cleanup(func() { _ = listener.Close() })

	connects := make(chan map[string]any, 1)
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		_, _ = io.WriteString(conn, `INFO {"server_id":"capture","version":"2.12.0","proto":1,"auth_required":true,"max_payload":1048576}`+"\r\n")
		line, err := bufio.NewReader(conn).ReadString('\n')
		if err != nil || !strings.HasPrefix(line, "CONNECT ") {
			return
		}
		var opts map[string]any
		if err := json.Unmarshal([]byte(strings.TrimPrefix(line, "CONNECT ")), &opts); err != nil {
			return
		}
		connects <- opts
	}()
	return "nats://" + listener.Addr().String(), connects
}

func connectedWith(t *testing.T, cfg Config) map[string]any {
	t.Helper()
	url, connects := captureConnect(t)
	cfg.URL = url
	client := NewClient(cfg, nil)
	// The capture server never answers the CONNECT, so this fails; only what
	// the client sent matters.
	go func() { _ = client.Connect() }()
	t.Cleanup(func() { _ = client.Close() })

	select {
	case opts := <-connects:
		return opts
	case <-time.After(5 * time.Second):
		t.Fatal("the client never sent CONNECT")
		return nil
	}
}

func TestTheClientSendsTheConfiguredToken(t *testing.T) {
	opts := connectedWith(t, Config{Name: "token-test", Token: "s3cret"})

	if opts["auth_token"] != "s3cret" {
		t.Fatalf("auth_token = %v, want s3cret", opts["auth_token"])
	}
}

func TestTheClientSendsNoTokenWhenNoneIsConfigured(t *testing.T) {
	opts := connectedWith(t, Config{Name: "token-test", Token: "  "})

	if _, present := opts["auth_token"]; present {
		t.Fatalf("auth_token = %v, want none", opts["auth_token"])
	}
}

// TestTheWebSocketUpgradeCarriesNoOrigin pins what the message bus's
// same-origin check relies on: it rejects only an upgrade whose Origin names
// another host, so a client that sends none is unaffected by it.
func TestTheWebSocketUpgradeCarriesNoOrigin(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer listener.Close()

	requests := make(chan *http.Request, 1)
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		req, err := http.ReadRequest(bufio.NewReader(conn))
		if err != nil {
			return
		}
		requests <- req
	}()

	client := NewClient(Config{URL: "ws://" + listener.Addr().String(), Name: "origin-test"}, nil)
	go func() { _ = client.Connect() }()
	t.Cleanup(func() { _ = client.Close() })

	select {
	case req := <-requests:
		if origin := req.Header.Get("Origin"); origin != "" {
			t.Fatalf("Origin = %q, want none", origin)
		}
		if req.Header.Get("Upgrade") != "websocket" {
			t.Fatalf("Upgrade = %q, want websocket", req.Header.Get("Upgrade"))
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the client never sent its upgrade request")
	}
}
