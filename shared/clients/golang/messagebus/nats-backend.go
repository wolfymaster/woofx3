package messagebus

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nkeys"
)

// NATSBackend implements MessageBus interface using NATS connection
type NATSBackend struct {
	config     NATSConfig
	logger     Logger
	connection *nats.Conn
	mu         sync.RWMutex
	ctx        context.Context
	cancel     context.CancelFunc
	wg         sync.WaitGroup
}

// NATSSubscription represents a NATS subscription
type NATSSubscription struct {
	subscription *nats.Subscription
	logger       Logger
	cancel       context.CancelFunc
}

// NewNATSBackend creates a new NATS backend instance
func NewNATSBackend(config NATSConfig, logger Logger) *NATSBackend {
	if logger == nil {
		logger = DefaultLogger()
	}

	ctx, cancel := context.WithCancel(context.Background())

	return &NATSBackend{
		config: config,
		logger: logger,
		ctx:    ctx,
		cancel: cancel,
	}
}

// Connect establishes connection to NATS server
func (n *NATSBackend) Connect() error {
	n.mu.Lock()
	defer n.mu.Unlock()

	if n.connection != nil {
		return nil
	}

	// Set up connection options
	opts := []nats.Option{
		nats.Name(n.getClientName()),
	}

	// Add JWT authentication if provided
	if n.config.JWT != "" && n.config.NKeySeed != "" {
		authOpt, err := n.createJWTAuth()
		if err != nil {
			return fmt.Errorf("failed to create JWT authentication: %w", err)
		}
		opts = append(opts, authOpt)
	}

	// Add connection event handlers
	opts = append(opts,
		nats.DisconnectErrHandler(func(nc *nats.Conn, err error) {
			if err != nil {
				n.logger.Error("NATS disconnected: %v", err)
			} else {
				n.logger.Info("NATS disconnected")
			}
		}),
		nats.ReconnectHandler(func(nc *nats.Conn) {
			n.logger.Info("NATS reconnected", "url", nc.ConnectedUrl())
		}),
		nats.ClosedHandler(func(nc *nats.Conn) {
			n.logger.Info("NATS connection closed")
		}),
		nats.ErrorHandler(func(nc *nats.Conn, sub *nats.Subscription, err error) {
			n.logger.Error("NATS error: %v", err)
		}),
	)

	// Connect to NATS server
	url := n.config.URL
	if url == "" {
		url = "wss://connect.ngs.global"
	}

	conn, err := nats.Connect(url, opts...)
	if err != nil {
		n.logger.Error("Failed to connect to NATS: %v", err)
		return fmt.Errorf("NATS connection failed: %w", err)
	}

	n.connection = conn
	n.logger.Info("Connected to NATS", "url", url, "name", n.getClientName())

	return nil
}

// createJWTAuth creates JWT authentication option
func (n *NATSBackend) createJWTAuth() (nats.Option, error) {
	// Decode the NKey seed
	kp, err := nkeys.FromSeed([]byte(n.config.NKeySeed))
	if err != nil {
		return nil, fmt.Errorf("failed to decode NKey seed: %w", err)
	}

	// Create JWT authenticator
	return nats.UserJWT(
		func() (string, error) {
			return n.config.JWT, nil
		},
		func(nonce []byte) ([]byte, error) {
			sig, err := kp.Sign(nonce)
			if err != nil {
				return nil, fmt.Errorf("failed to sign nonce: %w", err)
			}
			return sig, nil
		},
	), nil
}

// getClientName returns the client name for the connection
func (n *NATSBackend) getClientName() string {
	if n.config.Name != "" {
		return n.config.Name
	}
	return "messagebus-client"
}

// Publish sends a message to a subject
func (n *NATSBackend) Publish(subject string, data []byte) error {
	n.mu.RLock()
	conn := n.connection
	n.mu.RUnlock()

	if conn == nil {
		if err := n.Connect(); err != nil {
			return err
		}
		n.mu.RLock()
		conn = n.connection
		n.mu.RUnlock()
	}

	if conn == nil {
		return fmt.Errorf("NATS connection not available")
	}

	if err := conn.Publish(subject, data); err != nil {
		return fmt.Errorf("failed to publish message: %w", err)
	}

	n.logger.Debug("Published message", "subject", subject, "size", len(data))
	return nil
}

// Subscribe subscribes to a subject with a handler
func (n *NATSBackend) Subscribe(subject string, handler Handler, opts *SubscribeOptions) (Subscription, error) {
	n.mu.RLock()
	conn := n.connection
	n.mu.RUnlock()

	if conn == nil {
		if err := n.Connect(); err != nil {
			return nil, err
		}
		n.mu.RLock()
		conn = n.connection
		n.mu.RUnlock()
	}

	if conn == nil {
		return nil, fmt.Errorf("NATS connection not available")
	}

	// Create context for this subscription
	ctx, cancel := context.WithCancel(n.ctx)

	// Create NATS subscription
	sub, err := conn.Subscribe(subject, func(msg *nats.Msg) {
		// Wrap NATS message in our Msg interface
		wrappedMsg := NewMessageImpl(msg.Subject, msg.Data)

		// Call handler in goroutine to prevent blocking
		go func() {
			defer func() {
				if r := recover(); r != nil {
					n.logger.Error("Handler panic: %v", r)
				}
			}()
			handler(wrappedMsg)
		}()
	})

	if err != nil {
		cancel()
		return nil, fmt.Errorf("failed to subscribe: %w", err)
	}

	n.logger.Debug("Subscribed to subject", "subject", subject)

	return &NATSSubscription{
		subscription: sub,
		logger:       n.logger,
		cancel:       cancel,
	}, nil
}

// Close closes the NATS connection
func (n *NATSBackend) Close() error {
	n.cancel() // Cancel context to stop any running goroutines

	n.mu.Lock()
	defer n.mu.Unlock()

	if n.connection != nil {
		n.connection.Close()
		n.connection = nil
		n.logger.Info("NATS connection closed")
	}

	n.wg.Wait() // Wait for any running goroutines to finish
	return nil
}

// AsNATS returns the underlying NATS connection
func (n *NATSBackend) AsNATS() interface{} {
	n.mu.RLock()
	defer n.mu.RUnlock()
	return n.connection
}

// Unsubscribe removes the subscription
func (s *NATSSubscription) Unsubscribe() error {
	s.cancel() // Cancel the subscription context

	if s.subscription != nil {
		if err := s.subscription.Unsubscribe(); err != nil {
			return fmt.Errorf("failed to unsubscribe: %w", err)
		}
		s.logger.Debug("Unsubscribed from subject")
	}
	return nil
}

// Drain gracefully drains the subscription
func (s *NATSSubscription) Drain() error {
	s.cancel() // Cancel the subscription context

	if s.subscription != nil {
		if err := s.subscription.Drain(); err != nil {
			// Fallback to unsubscribe if drain fails
			s.logger.Debug("Drain failed, falling back to unsubscribe")
			if unsubErr := s.subscription.Unsubscribe(); unsubErr != nil {
				return fmt.Errorf("drain and unsubscribe both failed: drain=%w, unsubscribe=%w", err, unsubErr)
			}
		} else {
			s.logger.Debug("Drained subscription")
		}
	}
	return nil
}

// IsConnected returns true if the NATS connection is established and healthy
func (n *NATSBackend) IsConnected() bool {
	n.mu.RLock()
	defer n.mu.RUnlock()
	return n.connection != nil && n.connection.IsConnected()
}

// Status returns the current connection status
func (n *NATSBackend) Status() nats.Status {
	n.mu.RLock()
	defer n.mu.RUnlock()
	if n.connection == nil {
		return nats.DISCONNECTED
	}
	return n.connection.Status()
}

// Stats returns connection statistics
func (n *NATSBackend) Stats() nats.Statistics {
	n.mu.RLock()
	defer n.mu.RUnlock()
	if n.connection == nil {
		return nats.Statistics{}
	}
	return n.connection.Stats()
}

// Flush flushes the connection to the server
func (n *NATSBackend) Flush() error {
	n.mu.RLock()
	conn := n.connection
	n.mu.RUnlock()

	if conn == nil {
		return fmt.Errorf("NATS connection not available")
	}

	return conn.Flush()
}

// FlushTimeout flushes the connection with a timeout
func (n *NATSBackend) FlushTimeout(timeout int) error {
	n.mu.RLock()
	conn := n.connection
	n.mu.RUnlock()

	if conn == nil {
		return fmt.Errorf("NATS connection not available")
	}

	return conn.FlushTimeout(time.Duration(timeout) * time.Millisecond)
}
