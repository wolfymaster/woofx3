package services

import (
	"context"
	"strconv"

	models "github.com/wolfymaster/wolfyttv-db/models"
	rpc "github.com/wolfymaster/wolfyttv/buf"
	"gorm.io/gorm"
)

type CommandService struct {
	db *gorm.DB
}

func NewCommandService(db *gorm.DB) *CommandService {
	return &CommandService{
		db: db,
	}
}

func ToProto(cmd models.Command) *rpc.Command {
	return &rpc.Command{
		BroadcasterId: strconv.Itoa(cmd.BroadcasterID),
		Command:       cmd.Command,
		Type:          cmd.Type,
		TypeValue:     cmd.TypeValue,
	}
}

func (s *CommandService) GetCommands(ctx context.Context, req *rpc.GetCommandsRequest) (*rpc.GetCommandsResponse, error) {
	s.db.Config.Logger.Info(ctx, "Getting broadcaster commands")

	var commands []models.Command

	s.db.Find(&commands)

	protoCommands := make([]*rpc.Command, len(commands))

	println(protoCommands)

	for i, cmd := range commands {
		protoCommands[i] = ToProto(cmd)
	}

	return &rpc.GetCommandsResponse{
		Status: &rpc.ResponseStatus{
			Code: rpc.ResponseStatus_OK,
		},
		Commands: protoCommands,
	}, nil
}
