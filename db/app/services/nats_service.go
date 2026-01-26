package services

import (
	"context"
	"log/slog"

	"github.com/nats-io/nats.go"
	natsclient "github.com/wolfymaster/woofx3/clients/nats"
	"github.com/wolfymaster/woofx3/common/runtime"
)

type NatsService struct {
	*runtime.BaseService[*natsclient.Client]
	logger *slog.Logger
	client *natsclient.Client
	conn   *nats.Conn
}

func NewNATSService(logger *slog.Logger) *NatsService {
	return &NatsService{
		BaseService: runtime.NewBaseService[*natsclient.Client]("nats", "messagebus", nil, false), // NATS is monitored via liveness checks, not heartbeats
		logger:      logger,
	}
}

func (s *NatsService) Connect(ctx context.Context, appCtx *runtime.ApplicationContext) error {
	s.logger.Info("Connecting to NATS")

	client, err := natsclient.FromEnv(s.logger)
	if err != nil {
		return err
	}

	s.client = client
	s.conn = client.AsNATS()

	return s.BaseService.Connect(ctx, appCtx)
}

func (s *NatsService) Disconnect(ctx context.Context) error {
	s.logger.Info("Disconnecting from NATS")

	if s.conn != nil {
		s.conn.Close()
	}

	return s.BaseService.Disconnect(ctx)
}

func (s *NatsService) Connection() *nats.Conn {
	return s.conn
}

func (s *NatsService) Client() *natsclient.Client {
	return s.client
}
