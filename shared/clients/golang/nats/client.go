package nats

import (
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/nats-io/nats.go"
)

// ErrConnectionClosed is returned once the client's connection is closed for
// good. With unlimited reconnects that only happens after Close, so a caller
// seeing it is using a client that was shut down.
var ErrConnectionClosed = errors.New("NATS connection is closed")

// Defaults for reconnectPolicy. They match the TypeScript client's.
const (
	DefaultReconnectWait   = time.Second
	DefaultReconnectJitter = 500 * time.Millisecond
)

// reconnectPolicy is how a client waits between attempts to reach the bus
// again. It retries forever: a service outlives any bus outage, and nats.go
// restores every subscription on the connection it keeps reconnecting.
type reconnectPolicy struct {
	// Wait is the pause before retrying a server that was just tried.
	Wait time.Duration
	// Jitter is the most added at random to Wait, so a fleet of clients does
	// not reconnect in lockstep when the bus comes back.
	Jitter time.Duration
}

func defaultReconnectPolicy() reconnectPolicy {
	return reconnectPolicy{Wait: DefaultReconnectWait, Jitter: DefaultReconnectJitter}
}

type Client struct {
	config     Config
	reconnect  reconnectPolicy
	logger     *slog.Logger
	connection *nats.Conn
	closed     bool
	mu         sync.Mutex
}

func NewClient(config Config, logger *slog.Logger) *Client {
	if logger == nil {
		logger = slog.Default()
	}
	return &Client{
		config:    config,
		reconnect: defaultReconnectPolicy(),
		logger:    logger,
	}
}

func (c *Client) Connect() error {
	_, err := c.conn()
	return err
}

// conn returns the client's one connection, dialling it on first use. The
// connection is never replaced: nats.go keeps reconnecting it, buffers what
// is sent meanwhile and restores its subscriptions, whereas a second
// connection would carry none of them. Once it is closed the client is done
// and every call fails with ErrConnectionClosed. Holding mu for the whole call
// is what keeps concurrent callers from each dialling their own.
func (c *Client) conn() (*nats.Conn, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.closed || (c.connection != nil && c.connection.IsClosed()) {
		return nil, ErrConnectionClosed
	}
	if c.connection != nil {
		return c.connection, nil
	}

	conn, err := nats.Connect(c.config.URL, c.options()...)
	if err != nil {
		c.logger.Error("Failed to connect to NATS", "error", err)
		return nil, fmt.Errorf("failed to connect to NATS: %w", err)
	}

	c.connection = conn
	if !conn.IsConnected() {
		c.logger.Warn("NATS is not reachable yet, retrying in the background", "name", c.config.Name)
	}
	return conn, nil
}

// options are the connect options for the client's config, reconnect policy
// and connection event logging.
func (c *Client) options() []nats.Option {
	opts := []nats.Option{
		nats.Name(c.config.Name),
		// The bus and its dependents start in parallel, so the first dial
		// retries like a reconnect instead of failing the service.
		nats.RetryOnFailedConnect(true),
		nats.MaxReconnects(-1),
		nats.ReconnectWait(c.reconnect.Wait),
		nats.ReconnectJitter(c.reconnect.Jitter, c.reconnect.Jitter),
		nats.ConnectHandler(c.onConnect),
		nats.DisconnectErrHandler(c.onDisconnect),
		nats.ReconnectHandler(c.onReconnect),
		nats.ClosedHandler(c.onClosed),
		nats.ErrorHandler(c.onAsyncError),
	}
	if c.config.JWT != "" && c.config.NKeySeed != "" {
		opts = append(opts, nats.UserJWTAndSeed(c.config.JWT, c.config.NKeySeed))
	}
	if token := strings.TrimSpace(c.config.Token); token != "" {
		opts = append(opts, nats.Token(token))
	}
	return opts
}

// onConnect runs once, when the first dial or one of its retries succeeds.
func (c *Client) onConnect(conn *nats.Conn) {
	c.logger.Info("Connected to NATS", "url", conn.ConnectedUrlRedacted(), "name", c.config.Name)
}

func (c *Client) onDisconnect(_ *nats.Conn, err error) {
	if err == nil {
		c.logger.Info("NATS disconnected", "name", c.config.Name)
		return
	}
	c.logger.Warn("NATS disconnected", "name", c.config.Name, "error", err)
}

func (c *Client) onReconnect(conn *nats.Conn) {
	c.logger.Info("NATS reconnected", "name", c.config.Name, "url", conn.ConnectedUrlRedacted())
}

func (c *Client) onClosed(conn *nats.Conn) {
	if err := conn.LastError(); err != nil {
		c.logger.Error("NATS connection closed", "name", c.config.Name, "error", err)
		return
	}
	c.logger.Info("NATS connection closed", "name", c.config.Name)
}

// onAsyncError logs what nats.go reports outside any call: chiefly a slow
// consumer, whose subscription drops messages once its pending limit is hit.
func (c *Client) onAsyncError(_ *nats.Conn, sub *nats.Subscription, err error) {
	if sub == nil {
		c.logger.Error("NATS async error", "name", c.config.Name, "error", err)
		return
	}
	pendingMsgs, pendingBytes, pendingErr := sub.Pending()
	dropped, droppedErr := sub.Dropped()
	if countErr := errors.Join(pendingErr, droppedErr); countErr != nil {
		c.logger.Error("NATS async error", "name", c.config.Name, "subject", sub.Subject, "error", err,
			"countError", countErr)
		return
	}
	message := "NATS async error"
	if errors.Is(err, nats.ErrSlowConsumer) {
		message = "NATS slow consumer is dropping messages"
	}
	c.logger.Error(message, "name", c.config.Name, "subject", sub.Subject, "error", err,
		"pendingMsgs", pendingMsgs, "pendingBytes", pendingBytes, "dropped", dropped)
}

// Healthy reports whether the client can still reach the bus: it has dialled
// and its connection is not closed. A connection that is reconnecting counts
// as healthy, since nats.go buffers and restores it without the caller.
func (c *Client) Healthy() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return !c.closed && c.connection != nil && !c.connection.IsClosed()
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

// Close closes the connection for good; the client cannot be used after it.
func (c *Client) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.closed = true
	if c.connection != nil {
		c.connection.Close()
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
