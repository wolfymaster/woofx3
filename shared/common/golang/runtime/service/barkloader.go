package service

import (
	"context"

	barkloader "github.com/wolfymaster/woofx3/clients/barkloader"
	"github.com/wolfymaster/woofx3/common/runtime"
)

type BarkloaderService struct {
	*runtime.BaseService[*barkloader.Client]
	client *barkloader.Client
}

func NewBarkloaderService(client *barkloader.Client, useHealthCheck bool) *BarkloaderService {
	return &BarkloaderService{
		BaseService: runtime.NewBaseService(
			"barkloader",
			"barkloader",
			client,
			useHealthCheck,
		),
		client: client,
	}
}

func (s *BarkloaderService) Connect(ctx context.Context, appCtx *runtime.ApplicationContext) error {
	if err := s.client.Connect(); err != nil {
		return err
	}
	return s.BaseService.Connect(ctx, appCtx)
}

func (s *BarkloaderService) Disconnect(ctx context.Context) error {
	s.client.Disconnect()
	return s.BaseService.Disconnect(ctx)
}
