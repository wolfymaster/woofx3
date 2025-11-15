package services

import (
	"context"

	"github.com/wolfymaster/woofx3/db/db/models"
	repo "github.com/wolfymaster/woofx3/db/db/repository"
	rpc "github.com/wolfymaster/woofx3/db/gen/go"
)

type commandService struct {
	repo *repo.CommandRepository
}

func (s *commandService) CreateCommand(ctx context.Context, cmd *rpc.CreateCommandRequest) (*rpc.CommandResponse, error) {
	m := models.Command{
		ApplicationID: cmd.ApplicationId,
		Command:       cmd.Command,
	}

	err := s.repo.Create(&m)
	if err != nil {
		return nil, err
	}

	res := &rpc.CommandResponse{
		Status: &rpc.ResponseStatus{
			Code:    rpc.ResponseStatus_OK,
			Message: "Command created successfully",
		},
		Command: &rpc.Command{
			Id:            m.ID.String(),
			ApplicationId: m.ApplicationID.String(),
			Command:       m.Command,
		},
	}

	return res, nil
}

func NewCommandService(repo *repo.CommandRepository) rpc.CommandService {
	return &commandService{
		repo: repo,
	}
}
