package workflow

import (
	"context"
	"fmt"
	"log/slog"
	"time"
)

// PlatformGatewayTimeout is how long a send waits for the gateway's reply.
// It must exceed the gateway's own per-platform deadline. Must match
// CALLER_TIMEOUT_MS in connectors/src/config/gateway.ts.
const PlatformGatewayTimeout = 12 * time.Second

// NATSPlatformGateway sends chat through the connectors host's platform
// gateway.
type NATSPlatformGateway struct {
	bus     Bus
	timeout time.Duration
	logger  *slog.Logger
}

func NewNATSPlatformGateway(bus Bus, logger *slog.Logger) *NATSPlatformGateway {
	return &NATSPlatformGateway{bus: bus, timeout: PlatformGatewayTimeout, logger: logger}
}

func (g *NATSPlatformGateway) Send(ctx context.Context, payload []byte) ([]byte, error) {
	reply, err := g.bus.Request(ctx, "platform.gateway.send", payload, g.timeout)
	if err != nil {
		return nil, fmt.Errorf("platform gateway send: %w", err)
	}
	return reply, nil
}
