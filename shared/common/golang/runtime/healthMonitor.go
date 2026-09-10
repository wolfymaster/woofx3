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

// StartupDependencyProvider is optional. If a HealthMonitor implements it, the
// runtime waits for those services to report ready before starting the
// application.
//
// Distinct from RequiredServices, which connects local clients: a client
// connecting proves the dependency's process is accepting connections, not
// that it has finished the work a dependent needs done. Barkloader serves
// HTTP well before its bundled modules are installed, and a service that
// resolves a system canonical id in between gets a transient failure that
// reads like a missing module.
type StartupDependencyProvider interface {
	// StartupDependencies names the services to wait for, as they appear in
	// their own heartbeats.
	StartupDependencies() []string
	// PendingDependencies returns those not yet reporting ready. Empty means
	// the gate is satisfied.
	PendingDependencies() []string
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
