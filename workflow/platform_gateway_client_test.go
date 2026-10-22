package main

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	natsserver "github.com/nats-io/nats-server/v2/server"
	natsclient "github.com/wolfymaster/woofx3/clients/nats"
	"github.com/wolfymaster/woofx3/common/platformgateway"
)

// startEmbeddedNATS runs a real NATS server in the test process and returns a
// connected bus client.
func startEmbeddedNATS(t *testing.T) *natsclient.Client {
	t.Helper()
	server, err := natsserver.NewServer(&natsserver.Options{Host: "127.0.0.1", Port: natsserver.RANDOM_PORT, NoLog: true, NoSigs: true})
	if err != nil {
		t.Fatalf("start NATS: %v", err)
	}
	go server.Start()
	if !server.ReadyForConnections(5 * time.Second) {
		t.Fatal("NATS did not start")
	}
	t.Cleanup(server.Shutdown)
	client := natsclient.NewClient(natsclient.Config{Name: "workflow-test", URL: server.ClientURL()}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err := client.Connect(); err != nil {
		t.Fatalf("connect NATS: %v", err)
	}
	t.Cleanup(func() {
		if err := client.Close(); err != nil {
			t.Errorf("close NATS client: %v", err)
		}
	})
	return client
}

// serveGateway answers platform.gateway.send with the reply `answer` builds
// from the request, and records each request it decoded. A nil reply sends
// nothing, so the caller times out.
func serveGateway(t *testing.T, bus *natsclient.Client, answer func(platformgateway.GatewayRequest) []byte) <-chan platformgateway.GatewayRequest {
	t.Helper()
	seen := make(chan platformgateway.GatewayRequest, 4)
	sub, err := bus.SubscribeWithReply(string(platformgateway.SubjectSend), func(msg natsclient.Msg) []byte {
		var request platformgateway.GatewayRequest
		if err := json.Unmarshal(msg.Data(), &request); err != nil {
			t.Errorf("gateway got an unreadable request: %v", err)
			return nil
		}
		seen <- request
		return answer(request)
	})
	if err != nil {
		t.Fatalf("subscribe gateway: %v", err)
	}
	t.Cleanup(func() {
		if err := sub.Unsubscribe(); err != nil {
			t.Errorf("unsubscribe gateway: %v", err)
		}
	})
	return seen
}

func sendReplyEvent(replyType string, data string) []byte {
	return []byte(`{"specversion":"1.0","id":"r1","source":"connectors","type":"` + replyType + `","data":` + data + `}`)
}

func validChatSendRequest() platformgateway.GatewayRequest {
	return platformgateway.GatewayRequest{
		Action:         platformgateway.ActionChatSend,
		Target:         platformgateway.Target{Kind: platformgateway.TargetAll},
		Payload:        json.RawMessage(`{"message":"hello chat"}`),
		IdempotencyKey: "exec-1:say",
		RequestedBy:    platformgateway.RequestedBy{Kind: platformgateway.RequesterWorkflow, Ref: "wf-1"},
		WorkflowChain:  "wf-0,wf-1",
	}
}

func TestNATSPlatformGatewaySend(t *testing.T) {
	tests := []struct {
		name string
		// answer is nil for a gateway that is not subscribed at all.
		answer   func(platformgateway.GatewayRequest) []byte
		request  func() platformgateway.GatewayRequest
		wantOK   bool
		wantErr  error
		errText  string
		wantSent bool
	}{
		{
			name: "a delivered reply comes back as it was sent",
			answer: func(platformgateway.GatewayRequest) []byte {
				return sendReplyEvent(string(platformgateway.ReplyTypeSend), `{"ok":true,"results":{"twitch":{"status":"delivered","messageId":"m-1"}}}`)
			},
			request:  validChatSendRequest,
			wantOK:   true,
			wantSent: true,
		},
		{
			name: "a reply that is not ok is a reply, not an error",
			answer: func(platformgateway.GatewayRequest) []byte {
				return sendReplyEvent(string(platformgateway.ReplyTypeSend), `{"ok":false,"results":{"twitch":{"status":"unavailable","reason":"disabled"}}}`)
			},
			request:  validChatSendRequest,
			wantSent: true,
		},
		{
			name:    "nobody answering is unavailable",
			request: validChatSendRequest,
			wantErr: ErrGatewayUnavailable,
		},
		{
			name:     "silence past the timeout may have acted",
			answer:   func(platformgateway.GatewayRequest) []byte { return nil },
			request:  validChatSendRequest,
			wantErr:  ErrGatewayTimeout,
			wantSent: true,
		},
		{
			name: "a reply of another type is refused",
			answer: func(platformgateway.GatewayRequest) []byte {
				return sendReplyEvent("platform.gateway.capabilities.result", `{"ok":true,"results":{}}`)
			},
			request:  validChatSendRequest,
			errText:  `reply of type "platform.gateway.capabilities.result"`,
			wantSent: true,
		},
		{
			name: "a reply without ok is refused",
			answer: func(platformgateway.GatewayRequest) []byte {
				return sendReplyEvent(string(platformgateway.ReplyTypeSend), `{"results":{}}`)
			},
			request:  validChatSendRequest,
			errText:  "unreadable reply",
			wantSent: true,
		},
		{
			name: "a reply breaking an outcome's shape is refused",
			answer: func(platformgateway.GatewayRequest) []byte {
				return sendReplyEvent(string(platformgateway.ReplyTypeSend), `{"ok":false,"results":{"twitch":{"status":"failed"}}}`)
			},
			request:  validChatSendRequest,
			errText:  "invalid reply",
			wantSent: true,
		},
		{
			name: "an invalid request is refused before it is sent",
			answer: func(platformgateway.GatewayRequest) []byte {
				return sendReplyEvent(string(platformgateway.ReplyTypeSend), `{"ok":true,"results":{}}`)
			},
			request: func() platformgateway.GatewayRequest {
				request := validChatSendRequest()
				request.Payload = json.RawMessage(`{"message":"` + strings.Repeat("a", 501) + `"}`)
				return request
			},
			errText: "request is invalid",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			bus := startEmbeddedNATS(t)
			var seen <-chan platformgateway.GatewayRequest
			if tt.answer != nil {
				seen = serveGateway(t, bus, tt.answer)
			}
			gateway := NewNATSPlatformGateway(bus, quietLogger{})
			gateway.timeout = 200 * time.Millisecond

			reply, err := gateway.Send(tt.request())

			switch {
			case tt.wantErr != nil:
				if !errors.Is(err, tt.wantErr) {
					t.Fatalf("error = %v, want %v", err, tt.wantErr)
				}
			case tt.errText != "":
				if err == nil || !strings.Contains(err.Error(), tt.errText) {
					t.Fatalf("error = %v, want one containing %q", err, tt.errText)
				}
			default:
				if err != nil {
					t.Fatalf("Send: %v", err)
				}
				if reply.OK != tt.wantOK {
					t.Errorf("ok = %v, want %v", reply.OK, tt.wantOK)
				}
			}

			if seen == nil {
				return
			}
			select {
			case request := <-seen:
				if !tt.wantSent {
					t.Fatalf("the gateway got a request it should never have seen: %+v", request)
				}
				if request.IdempotencyKey != "exec-1:say" || request.WorkflowChain != "wf-0,wf-1" {
					t.Errorf("request arrived as %+v", request)
				}
			default:
				if tt.wantSent {
					t.Fatal("the gateway never got the request")
				}
			}
		})
	}
}

// The default wait is the caller's share of the gateway's deadlines; tests
// shorten it, so it is pinned here.
func TestNATSPlatformGatewayWaitsTheCallerTimeout(t *testing.T) {
	gateway := NewNATSPlatformGateway(nil, quietLogger{})
	if gateway.timeout != 12*time.Second {
		t.Errorf("timeout = %s, want 12s", gateway.timeout)
	}
}
