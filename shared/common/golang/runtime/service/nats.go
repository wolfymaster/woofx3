package service

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/nats-io/nats.go"
	natsclient "github.com/wolfymaster/woofx3/clients/nats"
	"github.com/wolfymaster/woofx3/common/runtime"
)

type NATSService struct {
	*runtime.BaseService[*natsclient.Client]
	logger *slog.Logger
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

func (s *NATSService) Disconnect(ctx context.Context) error {
	s.logger.Info("Disconnecting from NATS")
	if s.conn != nil {
		s.conn.Close()
		s.conn = nil
	}
	s.client = nil
	s.SetClient(nil)
	return s.BaseService.Disconnect(ctx)
}

func (s *NATSService) Connection() *nats.Conn {
	return s.conn
}
