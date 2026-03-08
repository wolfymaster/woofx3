package monitor

import (
	"context"
	"fmt"
	"sync"
	"time"

	natsclient "github.com/wolfymaster/woofx3/clients/nats"
	"github.com/wolfymaster/woofx3/common/cloudevents"
	"github.com/wolfymaster/woofx3/common/runtime"
	"github.com/wolfymaster/woofx3/common/runtime/service"
)

type heartbeatEntry struct {
	ready    bool
	lastSeen time.Time
}

type NATSClient interface {
	Publish(subject string, data []byte) error
	Subscribe(subject string, handler any) (any, error)
	Close() error
}

type NATSMonitor struct {
	serviceName       string
	svc               service.NATSService
	appName           string
	subject           string
	expirationTimeout time.Duration
	lastHeartbeats    map[string]*heartbeatEntry
	mu                sync.RWMutex
	readyFn           func() bool
	subscription      natsclient.Subscription
	logger            runtime.Logger
}

// NewNATS returns a health monitor that uses the given NATS service's client. serviceName is used for RequiredServices() so the runtime connects the service before Start().
func NewNATS(serviceName string, svc service.NATSService, appName, subject string, expirationTimeout time.Duration, logger runtime.Logger) *NATSMonitor {
	if subject == "" {
		subject = "HEARTBEAT"
	}
	if expirationTimeout == 0 {
		expirationTimeout = 15 * time.Second
	}
	return &NATSMonitor{
		serviceName:       serviceName,
		svc:               svc,
		appName:           appName,
		subject:           subject,
		expirationTimeout: expirationTimeout,
		lastHeartbeats:    make(map[string]*heartbeatEntry),
		logger:            logger,
	}
}

func (n *NATSMonitor) RequiredServices() []string {
	return []string{n.serviceName}
}

func (n *NATSMonitor) client() NATSClient {
	return n.svc.Client()
}

func (n *NATSMonitor) isClientNil() bool {
	client := n.client()
	if client == nil {
		return true
	}
	return false
}

func (n *NATSMonitor) Liveness() error {
	if n.isClientNil() {
		if n.logger != nil {
			n.logger.Error("Health monitor liveness check failed: NATS client is nil")
		}
		return fmt.Errorf("NATS client is nil")
	}
	client := n.client()
	testSubject := fmt.Sprintf("_HEALTH.%s.ping", n.appName)
	if err := client.Publish(testSubject, []byte("ping")); err != nil {
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

func (n *NATSMonitor) Start(ctx context.Context) error {
	if n.isClientNil() {
		return fmt.Errorf("cannot start health monitor: NATS client is nil")
	}
	client := n.client()

	if n.logger != nil {
		n.logger.Info("Starting NATS health monitor", "app", n.appName, "subject", n.subject, "timeout", n.expirationTimeout)
	}

	subAny, err := client.Subscribe(n.subject, func(msg natsclient.Msg) {
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
	sub, ok := subAny.(natsclient.Subscription)
	if !ok {
		return fmt.Errorf("Subscribe did not return natsclient.Subscription")
	}
	n.subscription = sub

	return nil
}

func (n *NATSMonitor) Stop() error {
	n.mu.Lock()
	sub := n.subscription
	n.subscription = nil
	n.lastHeartbeats = make(map[string]*heartbeatEntry)
	n.mu.Unlock()
	if sub != nil {
		_ = sub.Unsubscribe()
	}
	return nil
}

func (n *NATSMonitor) Heartbeat(ctx context.Context) error {
	if n.isClientNil() {
		return nil
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
	return n.client().Publish(n.subject, data)
}

func (n *NATSMonitor) HealthCheck(ctx context.Context, services runtime.ServicesRegistry) (bool, error) {
	if n.isClientNil() {
		if n.logger != nil {
			n.logger.Debug("Health check skipped - NATS client not available")
		}
		return true, nil
	}
	now := time.Now()

	n.mu.Lock()
	for app, entry := range n.lastHeartbeats {
		if now.Sub(entry.lastSeen) > n.expirationTimeout {
			delete(n.lastHeartbeats, app)
		}
	}
	n.mu.Unlock()

	for _, svc := range services {
		typedSvc, ok := svc.(interface {
			Healthcheck() bool
			Name() string
		})
		if !ok {
			continue
		}
		if !typedSvc.Healthcheck() {
			continue
		}
		n.mu.RLock()
		entry, exists := n.lastHeartbeats[typedSvc.Name()]
		n.mu.RUnlock()
		if !exists {
			if n.logger != nil {
				n.logger.Warn("Service health check failed - no heartbeat received", "service", typedSvc.Name())
			}
			return false, nil
		}
		if now.Sub(entry.lastSeen) > n.expirationTimeout {
			if n.logger != nil {
				n.logger.Warn("Service health check failed - heartbeat expired", "service", typedSvc.Name(), "last_seen", entry.lastSeen, "age", now.Sub(entry.lastSeen))
			}
			return false, nil
		}
		if !entry.ready {
			if n.logger != nil {
				n.logger.Warn("Service health check failed - service not ready", "service", typedSvc.Name())
			}
			return false, nil
		}
		if n.logger != nil {
			n.logger.Debug("Service health check passed", "service", typedSvc.Name())
		}
	}
	if n.logger != nil {
		n.logger.Debug("All service health checks passed")
	}
	return true, nil
}

// SetReadyFunction sets the ready function for this monitor's heartbeats.
func (n *NATSMonitor) SetReadyFunction(readyFn func() bool) {
	n.readyFn = readyFn
}
