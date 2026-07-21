package services

import (
	"context"
	"fmt"
	"log"

	"github.com/casbin/casbin/v2"
	"github.com/google/uuid"
	client "github.com/wolfymaster/woofx3/clients/db"
	refsvc "github.com/wolfymaster/woofx3/db/app/services/resource_reference"
	"github.com/wolfymaster/woofx3/db/database/models"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	commandVisibilityPublic     = "public"
	commandVisibilityRestricted = "restricted"
)

type commandService struct {
	repo       *repo.CommandRepository
	refRepo    *repo.ResourceReferenceRepository
	permRepo   *repo.CommandPermissionRepository
	casbinRepo *repo.PermissionRepository
	enforcer   *casbin.Enforcer
}

func NewCommandService(
	cmdRepo *repo.CommandRepository,
	refRepo *repo.ResourceReferenceRepository,
	permRepo *repo.CommandPermissionRepository,
	casbinRepo *repo.PermissionRepository,
	enforcer *casbin.Enforcer,
) *commandService {
	return &commandService{
		repo:       cmdRepo,
		refRepo:    refRepo,
		permRepo:   permRepo,
		casbinRepo: casbinRepo,
		enforcer:   enforcer,
	}
}

// syncCommandPermissions re-derives command_groups/command_users and the
// Casbin p-rows for a command from scratch. Called after every
// create/update so the DB join tables and Casbin's derived cache never
// drift. Public commands never get Casbin rows - visibility is checked in
// application code (woofwoofwoof) before Casbin is ever consulted.
func (s *commandService) syncCommandPermissions(appID uuid.UUID, cmd *models.Command, groupIDStrs, usernames []string) error {
	groupIDs := make([]uuid.UUID, 0, len(groupIDStrs))
	for _, idStr := range groupIDStrs {
		id, err := uuid.Parse(idStr)
		if err != nil {
			return fmt.Errorf("invalid group id %q: %w", idStr, err)
		}
		groupIDs = append(groupIDs, id)
	}

	if err := s.permRepo.ReplaceGroups(cmd.ID, groupIDs); err != nil {
		return err
	}
	if err := s.permRepo.ReplaceUsers(cmd.ID, usernames); err != nil {
		return err
	}

	object := "command/" + cmd.Command
	if err := s.casbinRepo.RemoveAllPTypeForObject(appID, object); err != nil {
		return err
	}
	if cmd.Visibility == commandVisibilityRestricted {
		for _, groupID := range groupIDs {
			if err := s.casbinRepo.AddPType(appID, groupSubject(groupID), object, "read", "allow"); err != nil {
				return err
			}
		}
		for _, username := range usernames {
			if err := s.casbinRepo.AddPType(appID, username, object, "read", "allow"); err != nil {
				return err
			}
		}
	}

	return s.enforcer.LoadPolicy()
}

func (s *commandService) syncCommandEdges(cmd *models.Command, cmdType, typeValue, createdByType, createdByRef string) {
	if s.refRepo == nil {
		return
	}
	appID := cmd.ApplicationID
	src := refsvc.CommandSource{
		ID:                  cmd.ID,
		Name:                cmd.Command,
		ApplicationID:       &appID,
		SourceCreatedByType: createdByType,
		SourceCreatedByRef:  createdByRef,
	}
	edges := refsvc.ExtractCommandEdges(src, cmdType, typeValue)
	if err := s.refRepo.ReplaceEdgesForSource("command", cmd.ID, edges); err != nil {
		log.Printf("command_service: ReplaceEdgesForSource failed for command %s: %v", cmd.ID, err)
	}
}

// toProtoCommand converts a persisted command plus its resolved group/user
// grants into the wire shape. groupIDs/usernames are looked up separately
// (permRepo) since they live in join tables, not on the commands row.
func (s *commandService) toProtoCommand(cmd *models.Command) (*client.Command, error) {
	groupIDs, err := s.permRepo.ListGroupIDs(cmd.ID)
	if err != nil {
		return nil, err
	}
	usernames, err := s.permRepo.ListUsernames(cmd.ID)
	if err != nil {
		return nil, err
	}
	groupIDStrs := make([]string, len(groupIDs))
	for i, id := range groupIDs {
		groupIDStrs[i] = id.String()
	}

	return &client.Command{
		Id:            cmd.ID.String(),
		ApplicationId: cmd.ApplicationID.String(),
		Command:       cmd.Command,
		Type:          cmd.Type,
		TypeValue:     cmd.TypeValue,
		Cooldown:      int32(cmd.Cooldown),
		CreatedByType: cmd.CreatedByType,
		CreatedByRef:  cmd.CreatedByRef,
		Priority:      int32(cmd.Priority),
		Enabled:       cmd.Enabled,
		CreatedAt:     timestamppb.New(cmd.CreatedAt),
		Visibility:      cmd.Visibility,
		GroupIds:        groupIDStrs,
		Usernames:       usernames,
		ArgumentPattern: cmd.ArgumentPattern,
	}, nil
}

func (s *commandService) CreateCommand(ctx context.Context, cmd *client.CreateCommandRequest) (*client.CommandResponse, error) {
	appIDStr, err := resolveApplicationID(ctx, s.repo.DB(), cmd.ApplicationId)
	if err != nil {
		return nil, err
	}
	applicationID, err := uuid.Parse(appIDStr)
	if err != nil {
		return nil, err
	}

	createdByType := cmd.CreatedByType
	if createdByType == "" {
		createdByType = "USER"
	}
	visibility := cmd.Visibility
	if visibility == "" {
		visibility = commandVisibilityRestricted
	}

	m := models.Command{
		ApplicationID:   applicationID,
		Command:         cmd.Command,
		Type:            cmd.Type,
		TypeValue:       cmd.TypeValue,
		Cooldown:        int(cmd.Cooldown),
		Priority:        int(cmd.Priority),
		Enabled:         cmd.Enabled,
		CreatedByType:   createdByType,
		CreatedByRef:    cmd.CreatedByRef,
		Visibility:      visibility,
		ArgumentPattern: cmd.ArgumentPattern,
	}

	err = s.repo.Create(&m)
	if err != nil {
		return nil, err
	}

	s.syncCommandEdges(&m, m.Type, m.TypeValue, m.CreatedByType, m.CreatedByRef)

	if err := s.syncCommandPermissions(applicationID, &m, cmd.GroupIds, cmd.Usernames); err != nil {
		return nil, err
	}

	protoCmd, err := s.toProtoCommand(&m)
	if err != nil {
		return nil, err
	}

	return &client.CommandResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Command created successfully",
		},
		Command: protoCmd,
	}, nil
}

func (s *commandService) GetCommand(ctx context.Context, req *client.GetCommandRequest) (*client.CommandResponse, error) {
	appIDStr, err := resolveApplicationID(ctx, s.repo.DB(), req.ApplicationId)
	if err != nil {
		return nil, err
	}
	applicationID, err := uuid.Parse(appIDStr)
	if err != nil {
		return nil, err
	}

	cmd, err := s.repo.GetByCommand(req.Command, applicationID)
	if err != nil {
		return nil, err
	}

	protoCmd, err := s.toProtoCommand(cmd)
	if err != nil {
		return nil, err
	}

	return &client.CommandResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Command retrieved successfully",
		},
		Command: protoCmd,
	}, nil
}

func (s *commandService) ListCommands(ctx context.Context, req *client.ListCommandsRequest) (*client.ListCommandsResponse, error) {
	commands, err := s.repo.GetAll()
	if err != nil {
		return nil, err
	}

	protoCommands := make([]*client.Command, len(commands))
	for i, cmd := range commands {
		protoCmd, err := s.toProtoCommand(cmd)
		if err != nil {
			return nil, err
		}
		protoCommands[i] = protoCmd
	}

	res := &client.ListCommandsResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Commands retrieved successfully",
		},
		Commands: protoCommands,
	}

	return res, nil
}

func (s *commandService) UpdateCommand(ctx context.Context, req *client.UpdateCommandRequest) (*client.CommandResponse, error) {
	commandId, err := uuid.Parse(req.Id)
	if err != nil {
		return nil, err
	}

	m, err := s.repo.GetByID(commandId)
	if err != nil {
		return nil, err
	}

	oldCommandName := m.Command
	m.Command = req.Command
	if req.Type != "" {
		m.Type = req.Type
	}
	m.TypeValue = req.TypeValue
	m.Cooldown = int(req.Cooldown)
	m.Priority = int(req.Priority)
	m.Enabled = req.Enabled
	if req.Visibility != "" {
		m.Visibility = req.Visibility
	}
	m.ArgumentPattern = req.ArgumentPattern

	err = s.repo.Update(m)
	if err != nil {
		return nil, err
	}

	s.syncCommandEdges(m, m.Type, m.TypeValue, m.CreatedByType, m.CreatedByRef)

	// A rename changes the "command/<name>" Casbin object string - clear the
	// old object's rows too, since syncCommandPermissions only re-derives
	// under the (possibly new) current name.
	if oldCommandName != m.Command {
		if err := s.casbinRepo.RemoveAllPTypeForObject(m.ApplicationID, "command/"+oldCommandName); err != nil {
			return nil, err
		}
	}

	if err := s.syncCommandPermissions(m.ApplicationID, m, req.GroupIds, req.Usernames); err != nil {
		return nil, err
	}

	protoCmd, err := s.toProtoCommand(m)
	if err != nil {
		return nil, err
	}

	return &client.CommandResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Command updated successfully",
		},
		Command: protoCmd,
	}, nil
}

func (s *commandService) DeleteCommand(ctx context.Context, req *client.DeleteCommandRequest) (*client.ResponseStatus, error) {
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

	if s.refRepo != nil {
		if err := s.refRepo.DeleteEdgesBySource("command", m.ID); err != nil {
			log.Printf("command_service: DeleteEdgesBySource failed for command %s: %v", m.ID, err)
		}
	}

	if err := s.permRepo.DeleteBySourceCommand(m.ID); err != nil {
		log.Printf("command_service: DeleteBySourceCommand failed for command %s: %v", m.ID, err)
	}
	if err := s.casbinRepo.RemoveAllPTypeForObject(m.ApplicationID, "command/"+m.Command); err != nil {
		log.Printf("command_service: RemoveAllPTypeForObject failed for command %s: %v", m.ID, err)
	}
	if err := s.enforcer.LoadPolicy(); err != nil {
		log.Printf("command_service: enforcer.LoadPolicy failed after deleting command %s: %v", m.ID, err)
	}

	res := &client.ResponseStatus{
		Code:    client.ResponseStatus_OK,
		Message: "Command deleted successfully",
	}

	return res, nil
}

func (s *commandService) HasPermission(ctx context.Context, enforcer *casbin.Enforcer, method string, request any) (bool, error) {
	switch method {
	case "GetCommand":
		var req client.GetCommandRequest
		if err := proto.Unmarshal(request.([]byte), &req); err != nil {
			return false, err
		}

		username := req.Username
		if username == nil || *username == "" {
			return false, fmt.Errorf("username is required")
		}

		appIDStr, err := resolveApplicationID(ctx, s.repo.DB(), req.ApplicationId)
		if err != nil {
			return false, err
		}
		appID, err := uuid.Parse(appIDStr)
		if err != nil {
			return false, err
		}
		cmd, err := s.repo.GetByCommand(req.Command, appID)
		if err != nil {
			return false, err
		}
		if cmd.Visibility == commandVisibilityPublic {
			return true, nil
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
