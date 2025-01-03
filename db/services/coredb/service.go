package coredb

import (
	"context"
	"log"

	"github.com/twitchtv/twirp"
)

type RPC struct{}

func (s *RPC) GetUserToken(ctx context.Context, req *GetUserTokenRequest) (*GetUserTokenResponse, error) {
	token := "123456789"

	token, err := GetToken(ctx, req.Username)
	if err != nil {
		log.Println("Error fetching token:", err)
		return nil, twirp.InternalErrorWith(err)
	}

	return &GetUserTokenResponse{Token: token}, nil
}
