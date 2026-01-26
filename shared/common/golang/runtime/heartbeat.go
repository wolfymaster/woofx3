package runtime

import (
	"context"
	"fmt"
	"sync"
	"time"

	natsclient "github.com/wolfymaster/woofx3/clients/nats"
	"github.com/wolfymaster/woofx3/common/cloudevents"
)

type HeartbeatFunc func(ctx context.Context) error
type HealthCheckFunc func(ctx context.Context, services ServicesRegistry) (bool, error)

// HealthMonitor represents the critical health monitoring infrastructure
type HealthMonitor interface {
	Liveness() error                 // Verify health monitor itself is working
	Start(ctx context.Context) error // Start the health monitor
	Stop() error                     // Stop the health monitor
}

// CombinedHealthMonitor represents implementations that provide both heartbeat and health checking
type CombinedHealthMonitor interface {
	HealthMonitor
	Heartbeat(ctx context.Context) error
	HealthCheck(ctx context.Context, services ServicesRegistry) (bool, error)
}

type NATSClient interface {
	Publish(subject string, data []byte) error
	Subscribe(subject string, handler natsclient.Handler) (natsclient.Subscription, error)
}

func CreateNATSHeartbeat(bus NATSClient, appName, subject string, readyFn func() bool) HeartbeatFunc {
	if subject == "" {
		subject = "HEARTBEAT"
	}

	return func(ctx context.Context) error {
		// Skip if bus is not available yet
		if bus == nil {
			return nil
		}

		ready := true
		if readyFn != nil {
			ready = readyFn()
		}

		event, err := cloudevents.ApplicationEvent.HeartbeatEvent(appName, ready)
		if err != nil {
			return err
		}

		data, err := cloudevents.Encode(event)
		if err != nil {
			return err
		}

		return bus.Publish(subject, data)
	}
}

func CreateNATSHealthCheck(bus NATSClient, subject string) HealthCheckFunc {
	if subject == "" {
		subject = "HEARTBEAT"
	}

	var mu sync.RWMutex
	subscribed := false
	readyByApp := make(map[string]bool) // Move this outside the closure

	return func(ctx context.Context, services ServicesRegistry) (bool, error) {
		// Skip if bus is not available yet
		if bus == nil {
			return true, nil
		}

		if !subscribed {
			_, err := bus.Subscribe(subject, func(msg natsclient.Msg) {

				var event cloudevents.Heartbeat
				if err := msg.JSON(&event); err != nil {
					return
				}

				data, err := event.Data()
				if err != nil {
					return
				}

				mu.Lock()
				readyByApp[data.Application] = data.Ready
				mu.Unlock()
			})

			if err != nil {
				return false, err
			}

			subscribed = true
		}

		mu.RLock()
		defer mu.RUnlock()

		for _, svc := range services {
			// Type assert to get service methods
			if typedSvc, ok := svc.(interface {
				Healthcheck() bool
				Name() string
			}); ok {
				if typedSvc.Healthcheck() {
					if !readyByApp[typedSvc.Name()] {
						return false, nil
					}
				}
			}
		}

		return true, nil
	}
}

// heartbeatEntry tracks the last heartbeat received for a service
type heartbeatEntry struct {
	ready    bool
	lastSeen time.Time
}

// NATSHealthMonitor implements CombinedHealthMonitor with timeout functionality
type NATSHealthMonitor struct {
	client            NATSClient
	appName           string
	subject           string
	expirationTimeout time.Duration
	lastHeartbeats    map[string]*heartbeatEntry
	mu                sync.RWMutex
	readyFn           func() bool
	subscription      natsclient.Subscription
	logger            Logger // Optional logger for debugging
}

// NewNATSHealthMonitor creates a new NATSHealthMonitor
func NewNATSHealthMonitor(bus NATSClient, appName, subject string, expirationTimeout time.Duration) *NATSHealthMonitor {
	if subject == "" {
		subject = "HEARTBEAT"
	}
	if expirationTimeout == 0 {
		expirationTimeout = 15 * time.Second // Default timeout
	}

	return &NATSHealthMonitor{
		client:            bus,
		appName:           appName,
		subject:           subject,
		expirationTimeout: expirationTimeout,
		lastHeartbeats:    make(map[string]*heartbeatEntry),
	}
}

// NewNATSHealthMonitorWithLogger creates a new NATSHealthMonitor with a logger
func NewNATSHealthMonitorWithLogger(bus NATSClient, appName, subject string, expirationTimeout time.Duration, logger Logger) *NATSHealthMonitor {
	monitor := NewNATSHealthMonitor(bus, appName, subject, expirationTimeout)
	monitor.logger = logger
	return monitor
}

// Liveness checks if the health monitor itself is working
func (n *NATSHealthMonitor) Liveness() error {
	if n.client == nil {
		if n.logger != nil {
			n.logger.Error("Health monitor liveness check failed: NATS client is nil")
		}
		return fmt.Errorf("NATS client is nil")
	}

	// Check if NATS connection is alive by attempting to publish a test message
	// We use a simple publish test rather than inspecting internal connection state
	testSubject := fmt.Sprintf("_HEALTH.%s.ping", n.appName)
	if err := n.client.Publish(testSubject, []byte("ping")); err != nil {
		if n.logger != nil {
			n.logger.Error("Health monitor liveness check failed: NATS publish failed", "error", err)
		}
		return fmt.Errorf("NATS connection failed: %w", err)
	}

	if n.logger != nil {
		n.logger.Debug("Health monitor liveness check passed: NATS is connected")
	}
	return nil
}

// Start begins the health monitor
func (n *NATSHealthMonitor) Start(ctx context.Context) error {
	if n.client == nil {
		return fmt.Errorf("cannot start health monitor: NATS client is nil")
	}

	if n.logger != nil {
		n.logger.Info("Starting NATS health monitor", "app", n.appName, "subject", n.subject, "timeout", n.expirationTimeout)
	}

	sub, err := n.client.Subscribe(n.subject, func(msg natsclient.Msg) {
		var event cloudevents.Heartbeat
		if err := msg.JSON(&event); err != nil {
			if n.logger != nil {
				n.logger.Debug("Failed to parse heartbeat message", "error", err)
			}
			return
		}

		data, err := event.Data()
		if err != nil {
			if n.logger != nil {
				n.logger.Debug("Failed to extract heartbeat data", "error", err)
			}
			return
		}

		n.mu.Lock()
		n.lastHeartbeats[data.Application] = &heartbeatEntry{
			ready:    data.Ready,
			lastSeen: time.Now(),
		}
		n.mu.Unlock()

		if n.logger != nil {
			n.logger.Debug("Received heartbeat", "from", data.Application, "ready", data.Ready)
		}
	})

	if err != nil {
		return fmt.Errorf("failed to subscribe to heartbeat subject: %w", err)
	}

	n.subscription = sub

	// Start heartbeat sender goroutine
	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()

		if n.logger != nil {
			n.logger.Info("Started heartbeat sender", "interval", "5s")
		}

		for {
			select {
			case <-ctx.Done():
				if n.logger != nil {
					n.logger.Info("Heartbeat sender stopped")
				}
				return
			case <-ticker.C:
				if err := n.Heartbeat(ctx); err != nil {
					if n.logger != nil {
						n.logger.Error("Heartbeat failed", "error", err)
					}
				} else {
					if n.logger != nil {
						n.logger.Debug("Heartbeat sent successfully")
					}
				}
			}
		}
	}()

	return nil
}

// Stop stops the health monitor
func (n *NATSHealthMonitor) Stop() error {
	if n.subscription != nil {
		// Note: This depends on the NATS client interface having an Unsubscribe method
		// For now, we'll just clear the subscription reference
		n.subscription = nil
	}

	n.mu.Lock()
	n.lastHeartbeats = make(map[string]*heartbeatEntry) // Clear all entries
	n.mu.Unlock()

	return nil
}

// Heartbeat sends a heartbeat from this monitor
func (n *NATSHealthMonitor) Heartbeat(ctx context.Context) error {
	if n.client == nil {
		return nil // Skip if client not available
	}

	ready := true
	if n.readyFn != nil {
		ready = n.readyFn()
	}

	event, err := cloudevents.ApplicationEvent.HeartbeatEvent(n.appName, ready)
	if err != nil {
		return err
	}

	data, err := cloudevents.Encode(event)
	if err != nil {
		return err
	}

	return n.client.Publish(n.subject, data)
}

// HealthCheck checks the health of all services with timeout functionality
func (n *NATSHealthMonitor) HealthCheck(ctx context.Context, services ServicesRegistry) (bool, error) {
	if n.client == nil {
		if n.logger != nil {
			n.logger.Debug("Health check skipped - NATS client not available")
		}
		return true, nil // Skip if client not available
	}

	now := time.Now()

	// Clean up expired entries
	cleanedCount := 0
	n.mu.Lock()
	for app, entry := range n.lastHeartbeats {
		if now.Sub(entry.lastSeen) > n.expirationTimeout {
			delete(n.lastHeartbeats, app)
			cleanedCount++
		}
	}
	n.mu.Unlock()

	if cleanedCount > 0 && n.logger != nil {
		n.logger.Debug("Cleaned up expired heartbeats", "count", cleanedCount)
	}

	// Check each service that requires health checking
	for _, svc := range services {
		if typedSvc, ok := svc.(interface {
			Healthcheck() bool
			Name() string
		}); ok {
			if typedSvc.Healthcheck() {
				n.mu.RLock()
				entry, exists := n.lastHeartbeats[typedSvc.Name()]
				n.mu.RUnlock()

				if !exists {
					// Service has never sent a heartbeat
					if n.logger != nil {
						n.logger.Warn("Service health check failed - no heartbeat received", "service", typedSvc.Name())
					}
					return false, nil
				}

				if now.Sub(entry.lastSeen) > n.expirationTimeout {
					// Service heartbeat has expired
					if n.logger != nil {
						n.logger.Warn("Service health check failed - heartbeat expired",
							"service", typedSvc.Name(),
							"last_seen", entry.lastSeen,
							"age", now.Sub(entry.lastSeen))
					}
					return false, nil
				}

				if !entry.ready {
					// Service is explicitly reporting as not ready
					if n.logger != nil {
						n.logger.Warn("Service health check failed - service not ready", "service", typedSvc.Name())
					}
					return false, nil
				}

				if n.logger != nil {
					n.logger.Debug("Service health check passed", "service", typedSvc.Name())
				}
			}
		}
	}

	if n.logger != nil {
		n.logger.Debug("All service health checks passed")
	}
	return true, nil
}

// SetReadyFunction sets the ready function for this monitor's heartbeats
func (n *NATSHealthMonitor) SetReadyFunction(readyFn func() bool) {
	n.readyFn = readyFn
}

// GetMonitoredServices returns the current status of all monitored services
func (n *NATSHealthMonitor) GetMonitoredServices() map[string]struct {
	Ready    bool
	LastSeen time.Time
	Alive    bool
} {
	n.mu.RLock()
	defer n.mu.RUnlock()

	result := make(map[string]struct {
		Ready    bool
		LastSeen time.Time
		Alive    bool
	})

	now := time.Now()
	for app, entry := range n.lastHeartbeats {
		alive := now.Sub(entry.lastSeen) <= n.expirationTimeout
		result[app] = struct {
			Ready    bool
			LastSeen time.Time
			Alive    bool
		}{
			Ready:    entry.ready,
			LastSeen: entry.lastSeen,
			Alive:    alive,
		}
	}

	return result
}

// LegacyHealthMonitor wraps legacy HeartbeatFunc and HealthCheckFunc into CombinedHealthMonitor
type LegacyHealthMonitor struct {
	heartbeatFunc   HeartbeatFunc
	healthCheckFunc HealthCheckFunc
}

// NewLegacyHealthMonitor creates a CombinedHealthMonitor from legacy functions
func NewLegacyHealthMonitor(heartbeat HeartbeatFunc, healthCheck HealthCheckFunc) CombinedHealthMonitor {
	return &LegacyHealthMonitor{
		heartbeatFunc:   heartbeat,
		healthCheckFunc: healthCheck,
	}
}

func (l *LegacyHealthMonitor) Liveness() error {
	// Legacy functions don't have liveness checking, assume healthy
	return nil
}

func (l *LegacyHealthMonitor) Start(ctx context.Context) error {
	// Legacy functions don't have explicit start/stop
	return nil
}

func (l *LegacyHealthMonitor) Stop() error {
	// Legacy functions don't have explicit start/stop
	return nil
}

func (l *LegacyHealthMonitor) Heartbeat(ctx context.Context) error {
	if l.heartbeatFunc == nil {
		return nil
	}
	return l.heartbeatFunc(ctx)
}

func (l *LegacyHealthMonitor) HealthCheck(ctx context.Context, services ServicesRegistry) (bool, error) {
	if l.healthCheckFunc == nil {
		return true, nil
	}
	return l.healthCheckFunc(ctx, services)
}
