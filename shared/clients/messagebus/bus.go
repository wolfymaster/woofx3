package messagebus

import (
	"context"
	"log/slog"

	"github.com/nats-io/nats.go"
)

// Msg is a type alias for NATS messages to maintain compatibility
type Msg = nats.Msg

// Handler defines a message handler function
type Handler func(msg *Msg)

// Subscription represents a message subscription
type Subscription interface {
	// Unsubscribe cancels the subscription
	Unsubscribe() error
	// Drain gracefully drains the subscription
	Drain() error
}

// Bus defines the message bus interface
type Bus interface {
	// Publish publishes data to a subject
	Publish(subject string, data []byte) error
	// Subscribe subscribes to a subject with a handler
	Subscribe(subject string, handler Handler, opts ...SubscribeOption) (Subscription, error)
	// Close closes the bus and all connections
	Close()
	// AsNATS returns the underlying NATS connection if available
	AsNATS() (*nats.Conn, bool)
}

// Backend represents the message bus backend type
type Backend string

const (
	// BackendNATS uses NATS server for messaging
	BackendNATS Backend = "nats"
	// BackendMemory uses in-memory pub/sub for messaging
	BackendMemory Backend = "memory"
)

// Config holds bus configuration
type Config struct {
	Backend Backend
	NATS    NATSConfig
	Logger  *slog.Logger
}

// NATSConfig holds NATS-specific configuration
type NATSConfig struct {
	URL      string
	Name     string
	JWT      string
	NKeySeed string
}

// SubscribeOption configures subscription behavior
type SubscribeOption func(*subscribeOptions)

type subscribeOptions struct {
	// Add future options here (queue groups, etc.)
}

// New creates a new message bus with the given configuration
func New(ctx context.Context, cfg Config) (Bus, error) {
	switch cfg.Backend {
	case BackendNATS:
		return newNATSBus(ctx, cfg)
	case BackendMemory:
		return newMemoryBus(ctx, cfg)
	default:
		return newMemoryBus(ctx, cfg)
	}
}