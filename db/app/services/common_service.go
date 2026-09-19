package services

import (
	"context"
	"errors"
	"fmt"
	"math"

	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/database"
	"github.com/wolfymaster/woofx3/db/database/migrate/migrations"
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
)

type CommonService struct {
	db *gorm.DB
}

func NewCommonService(db *gorm.DB) *CommonService {
	return &CommonService{db: db}
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

// MigrationStatus reports how much of this build's migration chain the
// database has applied. The chain is chosen by the dialect of the open
// connection, the same way the migrate tool chooses it.
func (s *CommonService) MigrationStatus(ctx context.Context, _ *client.MigrationStatusRequest) (*client.MigrationStatusResponse, error) {
	dialect := database.Dialect(s.db.Dialector.Name())
	chain, err := migrations.For(dialect)
	if err != nil {
		return nil, twirp.InternalErrorWith(err)
	}
	status, err := migrations.StatusOf(s.db.WithContext(ctx), chain)
	if err != nil {
		return nil, twirp.InternalErrorWith(err)
	}
	if status.Pending > math.MaxInt32 {
		return nil, twirp.InternalErrorWith(fmt.Errorf("pending migration count %d overflows int32", status.Pending))
	}
	return &client.MigrationStatusResponse{
		Status:  &client.ResponseStatus{Code: client.ResponseStatus_OK},
		Applied: status.Applied,
		Latest:  status.Latest,
		Pending: int32(status.Pending),
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
