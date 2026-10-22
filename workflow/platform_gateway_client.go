package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/nats-io/nats.go"
	natsclient "github.com/wolfymaster/woofx3/clients/nats"
	"github.com/wolfymaster/woofx3/common/platformgateway"
	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
)

// PlatformGatewayTimeout is how long a send waits for the gateway's reply. It
// must exceed the gateway's own deadline for every platform of a request (9 s,
// WOOFX3_CONNECTORS_GATEWAY_ADAPTER_DEADLINE_MS), so the gateway always gets
// to answer with per-platform results and a timeout here means connectors
// itself went quiet. Must match GATEWAY_CALLER_TIMEOUT_MS in
// connectors/src/config/gateway.ts.
const PlatformGatewayTimeout = 12 * time.Second

var (
	// ErrGatewayUnavailable is a request nobody answered at once: connectors
	// is not running or the bus is closed. Nothing reached a platform.
	ErrGatewayUnavailable = errors.New("the platform gateway is not running")
	// ErrGatewayTimeout is a request the gateway did not answer in time. It
	// was sent, so a platform may have acted on it.
	ErrGatewayTimeout = errors.New("the platform gateway did not answer in time; the platform may have acted")
	// ErrGatewayAbandoned is a request sent whose answer was never read: the
	// run was cancelled or the bus closed while waiting. A platform may have
	// acted on it.
	ErrGatewayAbandoned = errors.New("the platform gateway request was abandoned before it answered; the platform may have acted")
)

// PlatformGateway performs one action on streaming platforms and reports what
// happened on each. Declared here, where it is consumed, so actions can be
// tested against a fake.
type PlatformGateway interface {
	Send(ctx context.Context, request platformgateway.GatewayRequest) (platformgateway.GatewayReply, error)
}

// busRequester is the part of the message bus client a gateway send needs.
type busRequester interface {
	RequestWithContext(ctx context.Context, subject string, data []byte) ([]byte, error)
}

// NATSPlatformGateway sends requests to the platform gateway in connectors
// over the message bus. Built once per process and shared by every action.
type NATSPlatformGateway struct {
	bus     busRequester
	timeout time.Duration
	logger  tasks.Logger
}

func NewNATSPlatformGateway(bus busRequester, logger tasks.Logger) *NATSPlatformGateway {
	return &NATSPlatformGateway{bus: bus, timeout: PlatformGatewayTimeout, logger: logger}
}

// Send validates the request against the contract, sends it and reads the
// reply. A reply that is not ok is still a reply, returned without an error:
// what each platform did is the caller's to judge. The error is
// ErrGatewayUnavailable or ErrGatewayTimeout when no reply came, wrapped with
// context otherwise.
func (g *NATSPlatformGateway) Send(ctx context.Context, request platformgateway.GatewayRequest) (platformgateway.GatewayReply, error) {
	if err := request.Validate(); err != nil {
		return platformgateway.GatewayReply{}, fmt.Errorf("platform gateway request is invalid: %w", err)
	}
	body, err := json.Marshal(request)
	if err != nil {
		return platformgateway.GatewayReply{}, fmt.Errorf("marshal platform gateway request: %w", err)
	}
	waitCtx, cancel := context.WithTimeout(ctx, g.timeout)
	defer cancel()
	raw, err := g.bus.RequestWithContext(waitCtx, string(platformgateway.SubjectSend), body)
	if err != nil {
		return platformgateway.GatewayReply{}, g.requestError(request, err)
	}
	reply, err := readGatewayReply(raw)
	if err != nil {
		g.logger.Warn("platform gateway reply broke the contract",
			"action", request.Action, "idempotencyKey", request.IdempotencyKey, "error", err)
		return platformgateway.GatewayReply{}, err
	}
	return reply, nil
}

func (g *NATSPlatformGateway) requestError(request platformgateway.GatewayRequest, err error) error {
	switch {
	case errors.Is(err, nats.ErrNoResponders), errors.Is(err, natsclient.ErrConnectionClosed):
		g.logger.Warn("platform gateway is not running", "action", request.Action, "idempotencyKey", request.IdempotencyKey)
		return ErrGatewayUnavailable
	case errors.Is(err, context.Canceled), errors.Is(err, nats.ErrConnectionClosed):
		g.logger.Warn("platform gateway request abandoned", "action", request.Action, "idempotencyKey", request.IdempotencyKey, "error", err)
		return ErrGatewayAbandoned
	case errors.Is(err, nats.ErrTimeout), errors.Is(err, context.DeadlineExceeded):
		g.logger.Warn("platform gateway did not answer in time",
			"action", request.Action, "idempotencyKey", request.IdempotencyKey, "timeout", g.timeout)
		return ErrGatewayTimeout
	default:
		return fmt.Errorf("platform gateway request failed: %w", err)
	}
}

// readGatewayReply reads the gateway's CloudEvent reply, refusing one of
// another type or whose data breaks the contract.
func readGatewayReply(raw []byte) (platformgateway.GatewayReply, error) {
	var envelope struct {
		Type string          `json:"type"`
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return platformgateway.GatewayReply{}, fmt.Errorf("platform gateway sent an unreadable reply: %w", err)
	}
	if envelope.Type != string(platformgateway.ReplyTypeSend) {
		return platformgateway.GatewayReply{}, fmt.Errorf("platform gateway sent a reply of type %q, want %q", envelope.Type, platformgateway.ReplyTypeSend)
	}
	var reply platformgateway.GatewayReply
	if err := json.Unmarshal(envelope.Data, &reply); err != nil {
		return platformgateway.GatewayReply{}, fmt.Errorf("platform gateway sent an unreadable reply: %w", err)
	}
	if err := reply.Validate(); err != nil {
		return platformgateway.GatewayReply{}, fmt.Errorf("platform gateway sent an invalid reply: %w", err)
	}
	return reply, nil
}
