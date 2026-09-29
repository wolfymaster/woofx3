package nats

import (
	"fmt"
	"log/slog"
	"sync"
	"time"

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
	_, err := c.conn()
	return err
}

// conn returns the client's connection, dialling one only when there is none
// or the last one is closed for good. A connection that is reconnecting is
// returned as is: nats.go buffers what is sent meanwhile and restores its
// subscriptions, whereas dialling a second connection would orphan the first
// with every subscription on it. Holding mu for the whole call is what keeps
// concurrent callers from each dialling their own.
func (c *Client) conn() (*nats.Conn, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.connection != nil && !c.connection.IsClosed() {
		return c.connection, nil
	}

	opts := []nats.Option{
		nats.Name(c.config.Name),
	}

	if c.config.JWT != "" && c.config.NKeySeed != "" {
		opts = append(opts, nats.UserJWTAndSeed(c.config.JWT, c.config.NKeySeed))
	}

	conn, err := nats.Connect(c.config.URL, opts...)
	if err != nil {
		c.logger.Error("Failed to connect to NATS", "error", err)
		return nil, fmt.Errorf("failed to connect to NATS: %w", err)
	}

	c.connection = conn
	c.logger.Info("Connected to NATS", "url", c.config.URL, "name", c.config.Name)
	return conn, nil
}

func (c *Client) Publish(subject string, data []byte) error {
	conn, err := c.conn()
	if err != nil {
		return err
	}

	if err := conn.Publish(subject, data); err != nil {
		c.logger.Error("Failed to publish message", "error", err)
		return fmt.Errorf("failed to publish message: %w", err)
	}

	c.logger.Debug("Published message", "subject", subject, "size", len(data))
	return nil
}

func (c *Client) Subscribe(subject string, handler Handler) (Subscription, error) {
	conn, err := c.conn()
	if err != nil {
		return nil, err
	}

	sub, err := conn.Subscribe(subject, func(msg *nats.Msg) {
		wrappedMsg := &MessageImpl{
			subject: msg.Subject,
			data:    msg.Data,
		}
		handler(wrappedMsg)
	})

	if err != nil {
		c.logger.Error("Failed to subscribe", "error", err)
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

func (c *Client) Request(subject string, data []byte, timeout time.Duration) ([]byte, error) {
	conn, err := c.conn()
	if err != nil {
		return nil, err
	}

	msg, err := conn.Request(subject, data, timeout)
	if err != nil {
		c.logger.Error("Failed to send request", "error", err)
		return nil, fmt.Errorf("failed to send request: %w", err)
	}

	c.logger.Debug("Received response", "subject", subject, "size", len(msg.Data))
	return msg.Data, nil
}

func (c *Client) SubscribeWithReply(subject string, handler func(Msg) []byte) (Subscription, error) {
	conn, err := c.conn()
	if err != nil {
		return nil, err
	}

	sub, err := conn.Subscribe(subject, func(msg *nats.Msg) {
		wrappedMsg := &MessageImpl{
			subject: msg.Subject,
			data:    msg.Data,
		}
		response := handler(wrappedMsg)
		if response != nil && msg.Reply != "" {
			msg.Respond(response)
		}
	})

	if err != nil {
		c.logger.Error("Failed to subscribe with reply", "error", err)
		return nil, fmt.Errorf("failed to subscribe with reply: %w", err)
	}

	c.logger.Debug("Subscribed to subject with reply handler", "subject", subject)
	return sub, nil
}

func (c *Client) AsNATS() *nats.Conn {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.connection
}
