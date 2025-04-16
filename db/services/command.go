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

func (s *CommandService) SetCommand(ctx context.Context, req *rpc.Command) (*rpc.SetCommandResponse, error) {
	s.db.Config.Logger.Info(ctx, "Setting command")

	// Convert broadcaster ID from string to int
	broadcasterID, err := strconv.Atoi(req.BroadcasterId)
	if err != nil {
		return &rpc.SetCommandResponse{
			Status: &rpc.ResponseStatus{
				Code:    rpc.ResponseStatus_INVALID_ARGUMENT,
				Message: "Invalid broadcaster ID",
			},
		}, err
	}

	// Find existing command or create a new one
	var command models.Command
	result := s.db.Where("broadcaster_id = ? AND command = ?", broadcasterID, req.Command).First(&command)
	
	if result.Error != nil {
		// Command not found, create a new one
		command = models.Command{
			BroadcasterID: broadcasterID,
			Command:       req.Command,
		}
	}

	// Update Type if provided
	if req.Type != "" {
		command.Type = req.Type
	}

	// Update TypeValue if provided
	if req.TypeValue != "" {
		command.TypeValue = req.TypeValue
	}

	// Save the command (creates or updates)
	if result.Error != nil {
		// Create new record
		if err := s.db.Create(&command).Error; err != nil {
			return &rpc.SetCommandResponse{
				Status: &rpc.ResponseStatus{
					Code:    rpc.ResponseStatus_INTERNAL,
					Message: "Failed to create command",
				},
			}, err
		}
	} else {
		// Update existing record
		if err := s.db.Save(&command).Error; err != nil {
			return &rpc.SetCommandResponse{
				Status: &rpc.ResponseStatus{
					Code:    rpc.ResponseStatus_INTERNAL,
					Message: "Failed to update command",
				},
			}, err
		}
	}

	return &rpc.SetCommandResponse{
		Status: &rpc.ResponseStatus{
			Code: rpc.ResponseStatus_OK,
		},
		Command: ToProto(command),
	}, nil
}