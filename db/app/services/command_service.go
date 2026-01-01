package services

import (
	"context"
	"fmt"

	"github.com/casbin/casbin/v2"
	"github.com/google/uuid"
	rpc "github.com/wolfymaster/woofx3/db/app/server"
	"github.com/wolfymaster/woofx3/db/database/models"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type commandService struct {
	repo *repo.CommandRepository
}

func NewCommandService(repo *repo.CommandRepository) *commandService {
	return &commandService{
		repo: repo,
	}
}

func (s *commandService) CreateCommand(ctx context.Context, cmd *rpc.CreateCommandRequest) (*rpc.CommandResponse, error) {
	applicationID, err := uuid.Parse(cmd.ApplicationId)
	if err != nil {
		return nil, err
	}

	m := models.Command{
		ApplicationID: applicationID,
		Command:       cmd.Command,
	}

	err = s.repo.Create(&m)
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

func (s *commandService) GetCommand(ctx context.Context, req *rpc.GetCommandRequest) (*rpc.CommandResponse, error) {
	applicationID, err := uuid.Parse(req.ApplicationId)
	if err != nil {
		return nil, err
	}

	cmd, err := s.repo.GetByCommand(req.Command, applicationID)
	if err != nil {
		return nil, err
	}

	res := &rpc.CommandResponse{
		Status: &rpc.ResponseStatus{
			Code:    rpc.ResponseStatus_OK,
			Message: "Command retrieved successfully",
		},
		Command: &rpc.Command{
			Id:            cmd.ID.String(),
			ApplicationId: cmd.ApplicationID.String(),
			Command:       cmd.Command,
			Type:          cmd.Type,
			TypeValue:     cmd.TypeValue,
			Cooldown:      int32(cmd.Cooldown),
			CreatedBy:     cmd.CreatedBy.String(),
			Priority:      int32(cmd.Priority),
			Enabled:       cmd.Enabled,
			CreatedAt:     timestamppb.New(cmd.CreatedAt),
		},
	}

	return res, nil
}

func (s *commandService) ListCommands(ctx context.Context, req *rpc.ListCommandsRequest) (*rpc.ListCommandsResponse, error) {
	commands, err := s.repo.GetAll()
	if err != nil {
		return nil, err
	}

	protoCommands := make([]*rpc.Command, len(commands))
	for i, cmd := range commands {
		protoCommands[i] = &rpc.Command{
			Id:            cmd.ID.String(),
			ApplicationId: cmd.ApplicationID.String(),
			Command:       cmd.Command,
			Type:          cmd.Type,
			TypeValue:     cmd.TypeValue,
			Cooldown:      int32(cmd.Cooldown),
			CreatedBy:     cmd.CreatedBy.String(),
			Priority:      int32(cmd.Priority),
			Enabled:       cmd.Enabled,
			CreatedAt:     timestamppb.New(cmd.CreatedAt),
		}
	}

	res := &rpc.ListCommandsResponse{
		Status: &rpc.ResponseStatus{
			Code:    rpc.ResponseStatus_OK,
			Message: "Commands retrieved successfully",
		},
		Commands: protoCommands,
	}

	return res, nil
}

func (s *commandService) UpdateCommand(ctx context.Context, req *rpc.UpdateCommandRequest) (*rpc.CommandResponse, error) {
	commandId, err := uuid.Parse(req.Id)
	if err != nil {
		return nil, err
	}

	m, err := s.repo.GetByID(commandId)
	if err != nil {
		return nil, err
	}

	m.Command = req.Command

	err = s.repo.Update(m)
	if err != nil {
		return nil, err
	}

	res := &rpc.CommandResponse{
		Status: &rpc.ResponseStatus{
			Code:    rpc.ResponseStatus_OK,
			Message: "Command updated successfully",
		},
		Command: &rpc.Command{
			Id:            m.ID.String(),
			ApplicationId: m.ApplicationID.String(),
			Command:       m.Command,
		},
	}

	return res, nil
}

func (s *commandService) DeleteCommand(ctx context.Context, req *rpc.DeleteCommandRequest) (*rpc.ResponseStatus, error) {
	commandId, err := uuid.Parse(req.Id)
	if err != nil {
		return nil, err
	}

	m, err := s.repo.GetByID(commandId)
	if err != nil {
		return nil, err
	}

	err = s.repo.Delete(m)
	if err != nil {
		return nil, err
	}

	res := &rpc.ResponseStatus{
		Code:    rpc.ResponseStatus_OK,
		Message: "Command deleted successfully",
	}

	return res, nil
}

func (s *commandService) HasPermission(ctx context.Context, enforcer *casbin.Enforcer, method string, request any) (bool, error) {
	switch method {
	case "GetCommand":
		var req rpc.GetCommandRequest
		if err := proto.Unmarshal(request.([]byte), &req); err != nil {
			return false, err
		}

		username := req.Username
		if username == nil || *username == "" {
			return false, fmt.Errorf("username is required")
		}

		return enforcer.Enforce(*username, "command/"+req.Command, "read")
	case "ListCommands":
		return true, nil
	case "CreateCommand":
		return true, nil
	case "UpdateCommand":
		return true, nil
	case "DeleteCommand":
		return true, nil
	default:
		return false, nil
	}
}
