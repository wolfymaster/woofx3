package services

import (
	"context"

	rpc "github.com/wolfymaster/woofx3/db/app/server"
)

type CommonService struct{}

func NewCommonService() *CommonService {
	return &CommonService{}
}

// Ping implements the CommonService Ping RPC
// This will be available after regenerating proto code with: buf generate
func (s *CommonService) Ping(ctx context.Context, req *rpc.PingRequest) (*rpc.PingResponse, error) {
	return &rpc.PingResponse{
		Status: &rpc.ResponseStatus{
			Code:    rpc.ResponseStatus_OK,
			Message: "pong",
		},
	}, nil
}
