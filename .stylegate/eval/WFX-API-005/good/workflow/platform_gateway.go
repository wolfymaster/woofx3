package workflow

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/wolfymaster/woofx3/common/cloudevents"
	"github.com/wolfymaster/woofx3/common/platformgateway"
)

// NATSPlatformGateway sends chat through the connectors host's platform
// gateway.
type NATSPlatformGateway struct {
	bus     Bus
	timeout time.Duration
	logger  *slog.Logger
}

func NewNATSPlatformGateway(bus Bus, logger *slog.Logger) *NATSPlatformGateway {
	return &NATSPlatformGateway{bus: bus, timeout: platformgateway.CallerTimeout, logger: logger}
}

func (g *NATSPlatformGateway) Send(ctx context.Context, payload []byte) ([]byte, error) {
	subject := string(cloudevents.SubjectPlatformGatewaySend)
	reply, err := g.bus.Request(ctx, subject, payload, g.timeout)
	if err != nil {
		return nil, fmt.Errorf("platform gateway send: %w", err)
	}
	return reply, nil
}
