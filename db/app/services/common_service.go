package services

import (
	"context"
	"errors"

	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
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

// resolveApplicationID returns the requested application id when non-empty,
// or resolves to the id of the single default application when empty. It
// returns twirp.NotFound if the caller passed empty and no default exists
// yet (the engine is pre-onboarding).
func resolveApplicationID(ctx context.Context, db *gorm.DB, requested string) (string, error) {
	if requested != "" {
		return requested, nil
	}
	var app models.Application
	if err := db.WithContext(ctx).Where("is_default = ?", true).First(&app).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", twirp.NotFoundError("no default application; complete onboarding first")
		}
		return "", twirp.InternalErrorWith(err)
	}
	return app.ID.String(), nil
}
