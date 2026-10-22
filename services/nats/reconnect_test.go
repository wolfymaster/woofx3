package main

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/nats-io/nats-server/v2/server"
	"github.com/nats-io/nats.go"
	natsclient "github.com/wolfymaster/woofx3/clients/nats"
)

// reconnectTimeout covers the client's reconnect wait plus jitter a few times
// over, so a slow CI machine still sees the reconnect.
const reconnectTimeout = 15 * time.Second

// startTCPServer runs the bus with a TCP listener on port, as the Go services
// reach it, and stops it when the test ends.
func startTCPServer(t *testing.T, port int) *server.Server {
	t.Helper()
	cfg := DefaultConfiguration()
	cfg.Port = port
	cfg.NoLog = true
	cfg.WebSocketPort = -1
	ns, err := createServer(cfg, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	if err != nil {
		t.Fatalf("createServer: %v", err)
	}
	t.Cleanup(ns.Shutdown)
	return ns
}

// logRecords is a slog handler that keeps every record for a test to read.
type logRecords struct {
	mu      sync.Mutex
	records []slog.Record
}

func (l *logRecords) Enabled(context.Context, slog.Level) bool { return true }
func (l *logRecords) WithAttrs([]slog.Attr) slog.Handler       { return l }
func (l *logRecords) WithGroup(string) slog.Handler            { return l }

func (l *logRecords) Handle(_ context.Context, record slog.Record) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.records = append(l.records, record.Clone())
	return nil
}

// find returns the attributes of the first record with message, if any.
func (l *logRecords) find(message string) (map[string]string, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	for _, record := range l.records {
		if record.Message != message {
			continue
		}
		attrs := map[string]string{}
		record.Attrs(func(attr slog.Attr) bool {
			attrs[attr.Key] = attr.Value.String()
			return true
		})
		return attrs, true
	}
	return nil, false
}

func waitFor(t *testing.T, what string, done func() bool) {
	t.Helper()
	deadline := time.Now().Add(reconnectTimeout)
	for !done() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// A subscription made through the shared Go client still receives after the
// bus restarts: the client reconnects its one connection, which carries the
// subscription, instead of giving up or dialling a fresh one without it.
func TestTheGoClientKeepsItsSubscriptionsAcrossABusRestart(t *testing.T) {
	port := freePort(t)
	first := startTCPServer(t, port)
	url := fmt.Sprintf("nats://127.0.0.1:%d", port)

	logs := &logRecords{}
	client, err := natsclient.CreateMessageBus(natsclient.Config{URL: url, Name: "reconnect-test"}, slog.New(logs))
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(func() { _ = client.Close() })

	received := make(chan string, 1)
	if _, err := client.Subscribe("restart.test", func(msg natsclient.Msg) {
		received <- msg.String()
	}); err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	if err := client.AsNATS().Flush(); err != nil {
		t.Fatalf("flush: %v", err)
	}

	first.Shutdown()
	first.WaitForShutdown()
	waitFor(t, "the client to notice the bus went away", func() bool { return !client.AsNATS().IsConnected() })
	if !client.Healthy() {
		t.Fatal("a reconnecting client reports itself unhealthy")
	}

	startTCPServer(t, port)
	waitFor(t, "the client to reconnect", func() bool { return client.AsNATS().IsConnected() })
	if _, ok := logs.find("NATS reconnected"); !ok {
		t.Error("the reconnect was not logged")
	}

	publisher, err := nats.Connect(url)
	if err != nil {
		t.Fatalf("publisher connect: %v", err)
	}
	defer publisher.Close()
	// The subscription is resent as the client reconnects; flushing the
	// client makes sure the server has it before the publish.
	if err := client.AsNATS().Flush(); err != nil {
		t.Fatalf("flush after reconnect: %v", err)
	}
	if err := publisher.Publish("restart.test", []byte("after restart")); err != nil {
		t.Fatalf("publish: %v", err)
	}

	select {
	case got := <-received:
		if got != "after restart" {
			t.Fatalf("received %q, want %q", got, "after restart")
		}
	case <-time.After(reconnectTimeout):
		t.Fatal("the subscription received nothing after the restart")
	}
}

// A subscriber too slow to keep up drops messages; the client logs that with
// the subject and the pending counts instead of dropping them silently.
func TestTheGoClientLogsASlowConsumer(t *testing.T) {
	port := freePort(t)
	startTCPServer(t, port)
	url := fmt.Sprintf("nats://127.0.0.1:%d", port)

	logs := &logRecords{}
	client, err := natsclient.CreateMessageBus(natsclient.Config{URL: url, Name: "slow-consumer-test"}, slog.New(logs))
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(func() { _ = client.Close() })

	release := make(chan struct{})
	t.Cleanup(func() { close(release) })
	sub, err := client.Subscribe("slow.test", func(natsclient.Msg) { <-release })
	if err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	natsSub, ok := sub.(*nats.Subscription)
	if !ok {
		t.Fatalf("subscription is %T, want *nats.Subscription", sub)
	}
	if err := natsSub.SetPendingLimits(1, -1); err != nil {
		t.Fatalf("set pending limits: %v", err)
	}
	if err := client.AsNATS().Flush(); err != nil {
		t.Fatalf("flush: %v", err)
	}

	publisher, err := nats.Connect(url)
	if err != nil {
		t.Fatalf("publisher connect: %v", err)
	}
	defer publisher.Close()
	for i := 0; i < 5; i++ {
		if err := publisher.Publish("slow.test", []byte("burst")); err != nil {
			t.Fatalf("publish: %v", err)
		}
	}
	if err := publisher.Flush(); err != nil {
		t.Fatalf("publisher flush: %v", err)
	}

	var attrs map[string]string
	waitFor(t, "the slow consumer to be logged", func() bool {
		var found bool
		attrs, found = logs.find("NATS slow consumer is dropping messages")
		return found
	})
	if attrs["subject"] != "slow.test" {
		t.Errorf("subject = %q, want slow.test", attrs["subject"])
	}
	if !strings.Contains(attrs["error"], "slow consumer") {
		t.Errorf("error = %q, want the slow consumer error", attrs["error"])
	}
	for _, key := range []string{"pendingMsgs", "pendingBytes", "dropped"} {
		if _, present := attrs[key]; !present {
			t.Errorf("the log has no %s", key)
		}
	}
}
