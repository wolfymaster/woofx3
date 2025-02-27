package services

import (
	"context"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/twitchtv/twirp"

	userService "github.com/wolfymaster/wolfyttv-db/services/user"
	rpc "github.com/wolfymaster/wolfyttv/coredb"
)

type RPC struct {
	Db          *pgxpool.Pool
	UserService *userService.UserService
}

func (s *RPC) GetBroadcasterToken(ctx context.Context, req *rpc.GetBroadcasterTokenRequest) (*rpc.GetBroadcasterTokenResponse, error) {
	token, err := s.UserService.GetBroadcasterToken(ctx, req.BroadcasterId)
	if err != nil {
		slog.ErrorContext(ctx, "Error fetching token", "error", err)
		return nil, twirp.InternalErrorWith(err)
	}
	return &rpc.GetBroadcasterTokenResponse{Token: token}, nil
}

func (s *RPC) GetUserToken(ctx context.Context, req *rpc.GetUserTokenRequest) (*rpc.GetUserTokenResponse, error) {
	token, err := s.UserService.GetToken(ctx, req.UserId)
	if err != nil {
		slog.ErrorContext(ctx, "Error fetching token", "error", err)
		return nil, twirp.InternalErrorWith(err)
	}
	return &rpc.GetUserTokenResponse{Token: token}, nil
}

func (s *RPC) CreateUserEvent(ctx context.Context, req *rpc.CreateUserEventRequest) (*rpc.CreateUserEventResponse, error) {
	// need to look up user id, else insert it
	user, err := s.UserService.FindOrCreateUser(ctx, *req.User.UserId)
	if err != nil {
		slog.ErrorContext(ctx, "Error creating user event", "error", err)
		return nil, twirp.InternalErrorWith(err)
	}

	// then insert into userEvents
	s.UserService.CreateEvent(ctx, user.Id, req.Event.EventType, req.Event.EventValue)
	return &rpc.CreateUserEventResponse{
		User:  &rpc.TwitchUser{},
		Event: &rpc.UserEvent{},
	}, nil
}

func (s *RPC) CreateUserChatMessage(ctx context.Context, req *rpc.CreateUserChatMessageRequest) (*rpc.CreateUserChatMessageResponse, error) {
	return nil, nil
}
