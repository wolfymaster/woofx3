package runtime

import (
	"context"
)

// HealthMonitor represents the critical health monitoring infrastructure.
// The runtime calls Liveness periodically, starts the monitor via Start(), and drives Heartbeat and HealthCheck on an interval.
type HealthMonitor interface {
	Liveness() error                 // Verify health monitor itself is working
	Start(ctx context.Context) error // Start the health monitor (e.g. subscribe to heartbeat subject)
	Stop() error                     // Stop the health monitor
	Heartbeat(ctx context.Context) error
	HealthCheck(ctx context.Context, services ServicesRegistry) (bool, error)
}

// RequiredServicesProvider is optional. If a HealthMonitor implements it, the runtime connects those services before calling Start().
type RequiredServicesProvider interface {
	RequiredServices() []string
}

// HealthMonitorService is a HealthMonitor that is also a runtime Service. The runtime will connect it before Start() and Disconnect() after Stop().
type HealthMonitorService interface {
	HealthMonitor
	Connect(ctx context.Context, appCtx *ApplicationContext) error
	Disconnect(ctx context.Context) error
	Name() string
	Type() string
}
