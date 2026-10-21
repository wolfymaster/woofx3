package service

import (
	"context"
	"fmt"
	"log/slog"
	"sync"

	"github.com/nats-io/nats.go"
	natsclient "github.com/wolfymaster/woofx3/clients/nats"
	"github.com/wolfymaster/woofx3/common/runtime"
)

type NATSService struct {
	*runtime.BaseService[*natsclient.Client]
	logger *slog.Logger
	// mu guards client and conn, which health checks read from their own
	// goroutine while the runtime connects and disconnects the service.
	mu     sync.RWMutex
	client *natsclient.Client
	conn   *nats.Conn
}

func NewNATS(logger *slog.Logger, name, serviceType string) *NATSService {
	if name == "" {
		name = "nats"
	}
	if serviceType == "" {
		serviceType = "messagebus"
	}
	return &NATSService{
		BaseService: runtime.NewBaseService[*natsclient.Client](name, serviceType, nil, false),
		logger:      logger,
	}
}

func (s *NATSService) Connect(ctx context.Context, appCtx *runtime.ApplicationContext) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.client != nil && s.conn != nil {
		return nil
	}

	s.logger.Info("Connecting to NATS")

	natsConfig, ok := natsclient.FromConfig(appCtx.GetConfig())
	if !ok {
		return fmt.Errorf("application config has no nats.Config field or embedded nats.Config")
	}
	client, err := natsclient.CreateMessageBus(natsConfig, s.logger)
	if err != nil {
		return err
	}

	s.client = client
	s.conn = client.AsNATS()
	s.SetClient(client)

	return s.BaseService.Connect(ctx, appCtx)
}

// Connected reports whether the service connected and its client can still
// reach the bus. The client never replaces its connection, so once it is
// closed the service stays down until the process restarts.
func (s *NATSService) Connected() bool {
	return s.BaseService.Connected() && s.Healthy()
}

// Healthy reports whether the service's client has a connection that is not
// closed. A connection that is reconnecting is healthy.
func (s *NATSService) Healthy() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.client != nil && s.client.Healthy()
}

func (s *NATSService) Disconnect(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.logger.Info("Disconnecting from NATS")
	if s.client != nil {
		if err := s.client.Close(); err != nil {
			return fmt.Errorf("closing NATS client: %w", err)
		}
	}
	s.conn = nil
	s.client = nil
	s.SetClient(nil)
	return s.BaseService.Disconnect(ctx)
}

func (s *NATSService) Connection() *nats.Conn {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.conn
}
