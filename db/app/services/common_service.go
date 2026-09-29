package services

import (
	"context"
	"fmt"
	"math"

	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/database"
	"github.com/wolfymaster/woofx3/db/database/migrate/migrations"
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
