package nats

import (
	"fmt"
	"log/slog"
	"sync"

	"github.com/nats-io/nats.go"
)

type Client struct {
	config     Config
	logger     *slog.Logger
	connection *nats.Conn
	mu         sync.Mutex
}

func NewClient(config Config, logger *slog.Logger) *Client {
	if logger == nil {
		logger = slog.Default()
	}
	return &Client{
		config: config,
		logger: logger,
	}
}

func (c *Client) Connect() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.connection != nil && c.connection.IsConnected() {
		return nil
	}

	opts := []nats.Option{
		nats.Name(c.config.Name),
	}

	if c.config.JWT != "" && c.config.NKeySeed != "" {
		opts = append(opts, nats.UserJWTAndSeed(c.config.JWT, c.config.NKeySeed))
	}

	conn, err := nats.Connect(c.config.URL, opts...)
	if err != nil {
		c.logger.Error("Failed to connect to NATS: %v", err)
		return fmt.Errorf("failed to connect to NATS: %w", err)
	}

	c.connection = conn
	c.logger.Info("Connected to NATS", "url", c.config.URL, "name", c.config.Name)
	return nil
}

func (c *Client) Publish(subject string, data []byte) error {
	if c.connection == nil || !c.connection.IsConnected() {
		if err := c.Connect(); err != nil {
			return err
		}
	}

	if c.connection == nil {
		return fmt.Errorf("NATS connection not available")
	}

	if err := c.connection.Publish(subject, data); err != nil {
		c.logger.Error("Failed to publish message: %v", err)
		return fmt.Errorf("failed to publish message: %w", err)
	}

	c.logger.Debug("Published message", "subject", subject, "size", len(data))
	return nil
}

func (c *Client) Subscribe(subject string, handler Handler) (Subscription, error) {
	if c.connection == nil || !c.connection.IsConnected() {
		if err := c.Connect(); err != nil {
			return nil, err
		}
	}

	if c.connection == nil {
		return nil, fmt.Errorf("NATS connection not available")
	}

	sub, err := c.connection.Subscribe(subject, func(msg *nats.Msg) {
		wrappedMsg := &MessageImpl{
			subject: msg.Subject,
			data:    msg.Data,
		}
		handler(wrappedMsg)
	})

	if err != nil {
		c.logger.Error("Failed to subscribe: %v", err)
		return nil, fmt.Errorf("failed to subscribe: %w", err)
	}

	c.logger.Debug("Subscribed to subject", "subject", subject)
	return sub, nil
}

func (c *Client) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.connection != nil {
		c.connection.Close()
		c.connection = nil
		c.logger.Info("NATS connection closed")
	}
	return nil
}

func (c *Client) AsNATS() *nats.Conn {
	return c.connection
}
