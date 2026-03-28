package service

import (
	"context"
	"fmt"

	db "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/common/runtime"
)

type DbProxyService struct {
	*runtime.BaseService[*db.DbProxyClient]
	client *db.DbProxyClient
}

func NewDbProxyService(client *db.DbProxyClient, useHealthCheck bool) *DbProxyService {
	return &DbProxyService{
		BaseService: runtime.NewBaseService(
			"db",
			"db",
			client,
			useHealthCheck,
		),
		client: client,
	}
}

func (d *DbProxyService) Connect(ctx context.Context, appCtx *runtime.ApplicationContext) error {
	if d.client == nil || d.client.Common == nil {
		return fmt.Errorf("db proxy client not properly initialized")
	}

	_, err := d.client.Common.Ping(ctx, &db.PingRequest{})
	if err != nil {
		return fmt.Errorf("ping request failed: %w", err)
	}

	return d.BaseService.Connect(ctx, appCtx)
}

func (d *DbProxyService) Disconnect(ctx context.Context) error {
	// no-op for HTTP clients
	return d.BaseService.Disconnect(ctx)
}
