package messagebus

import (
        "context"
        "fmt"
        "log/slog"

        "github.com/nats-io/nats.go"
        "github.com/nats-io/nkeys"
)

// natsBus implements Bus using NATS
type natsBus struct {
        conn   *nats.Conn
        logger *slog.Logger
}

// natsSubscription wraps a NATS subscription
type natsSubscription struct {
        sub *nats.Subscription
}

func (s *natsSubscription) Unsubscribe() error {
        return s.sub.Unsubscribe()
}

func (s *natsSubscription) Drain() error {
        return s.sub.Drain()
}

func newNATSBus(ctx context.Context, cfg Config) (Bus, error) {
        logger := cfg.Logger
        if logger == nil {
                logger = slog.Default()
        }

        var opts []nats.Option
        opts = append(opts, nats.Name(cfg.NATS.Name))

        // Set up JWT authentication if provided
        if cfg.NATS.JWT != "" && cfg.NATS.NKeySeed != "" {
                kp, err := nkeys.FromSeed([]byte(cfg.NATS.NKeySeed))
                if err != nil {
                        return nil, fmt.Errorf("failed to parse NKey seed: %w", err)
                }

                opts = append(opts, nats.UserJWTAndSeed(cfg.NATS.JWT, cfg.NATS.NKeySeed))
                defer kp.Wipe()
        }

        // Connect to NATS
        url := cfg.NATS.URL
        if url == "" {
                url = nats.DefaultURL
        }

        conn, err := nats.Connect(url, opts...)
        if err != nil {
                return nil, fmt.Errorf("failed to connect to NATS: %w", err)
        }

        logger.Info("connected to NATS", "url", url, "name", cfg.NATS.Name)

        return &natsBus{
                conn:   conn,
                logger: logger,
        }, nil
}

func (n *natsBus) Publish(subject string, data []byte) error {
        return n.conn.Publish(subject, data)
}

func (n *natsBus) Subscribe(subject string, handler Handler, opts ...SubscribeOption) (Subscription, error) {
        // Wrap our Handler to match nats.MsgHandler signature
        natsHandler := nats.MsgHandler(handler)
        
        sub, err := n.conn.Subscribe(subject, natsHandler)
        if err != nil {
                return nil, fmt.Errorf("failed to subscribe to %s: %w", subject, err)
        }

        n.logger.Debug("subscribed to subject", "subject", subject)

        return &natsSubscription{sub: sub}, nil
}

func (n *natsBus) Close() {
        if n.conn != nil {
                n.conn.Close()
                n.logger.Info("NATS connection closed")
        }
}

func (n *natsBus) AsNATS() (*nats.Conn, bool) {
        return n.conn, true
}