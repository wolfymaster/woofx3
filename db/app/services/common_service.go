package services

import (
	"context"

	client "github.com/wolfymaster/woofx3/clients/db"
)

type CommonService struct{}

func NewCommonService() *CommonService {
	return &CommonService{}
}

// Ping implements the CommonService Ping RPC
// This will be available after regenerating proto code with: buf generate
func (s *CommonService) Ping(ctx context.Context, req *client.PingRequest) (*client.PingResponse, error) {
	return &client.PingResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "pong",
		},
	}, nil
}
