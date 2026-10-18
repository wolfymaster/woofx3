package services

import (
	"context"
	"errors"
	"fmt"
	"log"
	"log/slog"
	"strings"

	"github.com/casbin/casbin/v2"
	"github.com/google/uuid"
	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	refsvc "github.com/wolfymaster/woofx3/db/app/services/resource_reference"
	"github.com/wolfymaster/woofx3/db/app/workers"
	"github.com/wolfymaster/woofx3/db/database/models"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
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
	groupRepo  *repo.GroupRepository
	enforcer   *casbin.Enforcer
	publisher  *workers.EventPublisher
}

func NewCommandService(
	cmdRepo *repo.CommandRepository,
	refRepo *repo.ResourceReferenceRepository,
	permRepo *repo.CommandPermissionRepository,
	casbinRepo *repo.PermissionRepository,
	groupRepo *repo.GroupRepository,
	enforcer *casbin.Enforcer,
	publisher *workers.EventPublisher,
) *commandService {
	return &commandService{
		repo:       cmdRepo,
		refRepo:    refRepo,
		permRepo:   permRepo,
		casbinRepo: casbinRepo,
		groupRepo:  groupRepo,
		enforcer:   enforcer,
		publisher:  publisher,
	}
}

// syncCommandPermissions re-derives command_groups/command_users and the
// Casbin p-rows for a command from scratch. Called after every
// create/update so the DB join tables and Casbin's derived cache never
// drift. Public commands never get Casbin rows - visibility is checked in
// application code (woofwoofwoof) before Casbin is ever consulted.
func (s *commandService) syncCommandPermissions(cmd *models.Command, groupIDStrs, usernames []string) error {
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
	if err := s.casbinRepo.RemoveAllPTypeForObject(object); err != nil {
		return err
	}
	if cmd.Visibility == commandVisibilityRestricted {
		// No group and no user grant means no restriction was configured, not
		// "deny everyone". Say so positively in the policy data with the
		// wildcard subject so every enforcement path agrees; leaving the object
		// with zero rules would deny it everywhere instead.
		if len(groupIDs) == 0 && len(usernames) == 0 {
			if err := s.casbinRepo.AddPType(models.WildcardSubject, object, "read", "allow"); err != nil {
				return err
			}
			return s.enforcer.LoadPolicy()
		}

		everyoneIDs, err := s.everyoneGroupIDs(groupIDs)
		if err != nil {
			return err
		}
		for _, groupID := range groupIDs {
			subject := groupSubject(groupID)
			if everyoneIDs[groupID] {
				// The built-in "everyone" group has no membership rows by
				// design, so a group: subject would never match. Collapse it to
				// the wildcard the matcher understands.
				subject = models.WildcardSubject
			}
			if err := s.casbinRepo.AddPType(subject, object, "read", "allow"); err != nil {
				return err
			}
		}
		for _, username := range usernames {
			if err := s.casbinRepo.AddPType(username, object, "read", "allow"); err != nil {
				return err
			}
		}
	}

	return s.enforcer.LoadPolicy()
}

// everyoneGroupIDs reports which of the given ids are the built-in "everyone"
// group. Returns an empty set when no group repository is wired, so callers
// degrade to plain group subjects rather than failing.
func (s *commandService) everyoneGroupIDs(groupIDs []uuid.UUID) (map[uuid.UUID]bool, error) {
	out := make(map[uuid.UUID]bool)
	if s.groupRepo == nil || len(groupIDs) == 0 {
		return out, nil
	}
	groups, err := s.groupRepo.GetByIDs(groupIDs)
	if err != nil {
		return nil, err
	}
	for i := range groups {
		if groups[i].IsBuiltIn && groups[i].Name == models.GroupEveryone {
			out[groups[i].ID] = true
		}
	}
	return out, nil
}

// defaultActionsJSON keeps the column and the wire holding a JSON array rather
// than an empty string, so every reader can decode without a special case.
func defaultActionsJSON(actions string) string {
	if strings.TrimSpace(actions) == "" {
		return "[]"
	}
	return actions
}

func (s *commandService) syncCommandEdges(cmd *models.Command, actionsJSON, createdByType, createdByRef string) {
	if s.refRepo == nil {
		return
	}
	src := refsvc.CommandSource{
		ID:                  cmd.ID,
		Name:                cmd.Command,
		SourceCreatedByType: createdByType,
		SourceCreatedByRef:  createdByRef,
	}
	edges := refsvc.ExtractCommandEdges(src, actionsJSON)
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
	wf, err := linkedWorkflow(s.repo.DB(), cmd)
	if err != nil {
		return nil, err
	}
	workflowID, stepsJSON := "", "[]"
	if wf != nil {
		workflowID, stepsJSON = wf.ID.String(), wf.Steps
	}

	return &client.Command{
		Id:              cmd.ID.String(),
		Command:         cmd.Command,
		ActionsJson:     defaultActionsJSON(cmd.Actions),
		Cooldown:        int32(cmd.Cooldown),
		CreatedByType:   cmd.CreatedByType,
		CreatedByRef:    cmd.CreatedByRef,
		Priority:        int32(cmd.Priority),
		Enabled:         cmd.Enabled,
		CreatedAt:       timestamppb.New(cmd.CreatedAt),
		Visibility:      cmd.Visibility,
		GroupIds:        groupIDStrs,
		Usernames:       usernames,
		ArgumentPattern: cmd.ArgumentPattern,
		WorkflowId:      workflowID,
		StepsJson:       stepsJSON,
	}, nil
}

// publishChange announces a command row change on the outbox. The api
// projects it onto the UI's command webhooks, which is the only way the UI
// hears about commands written by something other than the api's own command
// routes -- barkloader registering a module's commands, for one.
func (s *commandService) publishChange(cmd *client.Command, op string) {
	if s.publisher == nil {
		return
	}
	s.publisher.Publish(workers.PublishOptions{
		EntityType:      "command",
		EntityID:        cmd.Id,
		Operation:       op,
		Data:            buildCommandChangeData(cmd),
		AutoAcknowledge: true,
	})
}

func buildCommandChangeData(cmd *client.Command) map[string]any {
	return map[string]any{
		"id":               cmd.Id,
		"command":          cmd.Command,
		"actions_json":     cmd.ActionsJson,
		"cooldown":         cmd.Cooldown,
		"priority":         cmd.Priority,
		"enabled":          cmd.Enabled,
		"visibility":       cmd.Visibility,
		"group_ids":        cmd.GroupIds,
		"usernames":        cmd.Usernames,
		"argument_pattern": cmd.ArgumentPattern,
		"created_by_type":  cmd.CreatedByType,
		"created_by_ref":   cmd.CreatedByRef,
		"workflow_id":      cmd.WorkflowId,
		"steps_json":       cmd.StepsJson,
	}
}

func (s *commandService) CreateCommand(ctx context.Context, cmd *client.CreateCommandRequest) (*client.CommandResponse, error) {
	createdByType := cmd.CreatedByType
	if createdByType == "" {
		createdByType = "USER"
	}
	visibility := cmd.Visibility
	if visibility == "" {
		visibility = commandVisibilityRestricted
	}

	// A module declares its commands in its manifest and registers them on
	// every install, but once one exists it belongs to the streamer: they
	// edit its actions, cooldown and permissions. Re-registering must leave
	// that row alone, id included, or an upgrade silently discards their
	// edits and orphans every reference to the old id.
	if createdByType == "MODULE" {
		existing, err := s.repo.GetByOrigin(createdByType, cmd.CreatedByRef, cmd.Command)
		if err == nil {
			protoCmd, err := s.toProtoCommand(existing)
			if err != nil {
				return nil, err
			}
			return &client.CommandResponse{
				Status: &client.ResponseStatus{
					Code:    client.ResponseStatus_OK,
					Message: "Command already registered",
				},
				Command: protoCmd,
			}, nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
	}

	// Assign the id here rather than leaning on the column default: that
	// default is Postgres-only (uuid_generate_v4()), so on the SQLite backend
	// every command would otherwise be inserted with the zero UUID and collide.
	m := models.Command{
		ID:              uuid.New(),
		Command:         cmd.Command,
		Actions:         defaultActionsJSON(cmd.ActionsJson),
		Cooldown:        int(cmd.Cooldown),
		Priority:        int(cmd.Priority),
		Enabled:         cmd.Enabled,
		CreatedByType:   createdByType,
		CreatedByRef:    cmd.CreatedByRef,
		Visibility:      visibility,
		ArgumentPattern: cmd.ArgumentPattern,
	}

	steps := cmd.StepsJson
	if strings.TrimSpace(steps) == "" {
		chained, err := chainActions(m.Actions)
		if err != nil {
			return nil, twirp.InvalidArgumentError("actions_json", err.Error())
		}
		steps = chained
	}

	var change *commandWorkflowChange
	err := s.repo.Transaction(func(tx *gorm.DB) error {
		var err error
		change, err = setCommandSteps(tx, &m, steps)
		if err != nil {
			return err
		}
		if err := tx.Create(&m).Error; err != nil {
			return err
		}
		return change.announceIn(tx, s.publisher)
	})
	if err != nil {
		return nil, err
	}

	change.syncEdges(s.refRepo)
	s.syncCommandEdges(&m, m.Actions, m.CreatedByType, m.CreatedByRef)

	if err := s.syncCommandPermissions(&m, cmd.GroupIds, cmd.Usernames); err != nil {
		return nil, err
	}

	protoCmd, err := s.toProtoCommand(&m)
	if err != nil {
		return nil, err
	}
	s.publishChange(protoCmd, "created")

	return &client.CommandResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Command created successfully",
		},
		Command: protoCmd,
	}, nil
}

func (s *commandService) GetCommand(ctx context.Context, req *client.GetCommandRequest) (*client.CommandResponse, error) {
	cmd, err := s.repo.GetByCommand(req.Command)
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
	m.Cooldown = int(req.Cooldown)
	m.Priority = int(req.Priority)
	m.Enabled = req.Enabled
	if req.Visibility != "" {
		m.Visibility = req.Visibility
	}
	m.ArgumentPattern = req.ArgumentPattern

	steps, err := updatedCommandSteps(req)
	if err != nil {
		return nil, err
	}

	var change *commandWorkflowChange
	err = s.repo.Transaction(func(tx *gorm.DB) error {
		var err error
		switch {
		case steps != nil:
			change, err = setCommandSteps(tx, m, *steps)
		case oldCommandName != m.Command:
			change, err = renameCommandWorkflow(tx, m)
		}
		if err != nil {
			return err
		}
		if err := tx.Save(m).Error; err != nil {
			return err
		}
		return change.announceIn(tx, s.publisher)
	})
	if err != nil {
		return nil, err
	}

	change.syncEdges(s.refRepo)
	s.syncCommandEdges(m, m.Actions, m.CreatedByType, m.CreatedByRef)

	// A rename changes the "command/<name>" Casbin object string - clear the
	// old object's rows too, since syncCommandPermissions only re-derives
	// under the (possibly new) current name.
	if oldCommandName != m.Command {
		if err := s.casbinRepo.RemoveAllPTypeForObject("command/" + oldCommandName); err != nil {
			return nil, err
		}
	}

	if err := s.syncCommandPermissions(m, req.GroupIds, req.Usernames); err != nil {
		return nil, err
	}

	protoCmd, err := s.toProtoCommand(m)
	if err != nil {
		return nil, err
	}
	s.publishChange(protoCmd, "updated")

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

	var change *commandWorkflowChange
	err = s.repo.Transaction(func(tx *gorm.DB) error {
		var err error
		change, err = setCommandSteps(tx, m, "[]")
		if err != nil {
			return err
		}
		if err := tx.Delete(m).Error; err != nil {
			return err
		}
		return change.announceIn(tx, s.publisher)
	})
	if err != nil {
		return nil, err
	}
	change.syncEdges(s.refRepo)

	if s.refRepo != nil {
		if err := s.refRepo.DeleteEdgesBySource("command", m.ID); err != nil {
			log.Printf("command_service: DeleteEdgesBySource failed for command %s: %v", m.ID, err)
		}
	}

	if err := s.permRepo.DeleteBySourceCommand(m.ID); err != nil {
		log.Printf("command_service: DeleteBySourceCommand failed for command %s: %v", m.ID, err)
	}
	if err := s.casbinRepo.RemoveAllPTypeForObject("command/" + m.Command); err != nil {
		log.Printf("command_service: RemoveAllPTypeForObject failed for command %s: %v", m.ID, err)
	}
	if err := s.enforcer.LoadPolicy(); err != nil {
		log.Printf("command_service: enforcer.LoadPolicy failed after deleting command %s: %v", m.ID, err)
	}

	if s.publisher != nil {
		s.publisher.Publish(workers.PublishOptions{
			EntityType:      "command",
			EntityID:        m.ID.String(),
			Operation:       "deleted",
			Data:            map[string]any{"id": m.ID.String(), "command": m.Command},
			AutoAcknowledge: true,
		})
	}

	res := &client.ResponseStatus{
		Code:    client.ResponseStatus_OK,
		Message: "Command deleted successfully",
	}

	return res, nil
}

// updatedCommandSteps is what an update makes the command's steps: nil to
// leave them as they are, or the tasks its workflow should hold. steps_json
// wins; otherwise a non-empty actions_json (a writer that knows commands as
// action lists) replaces them with those actions run in order.
func updatedCommandSteps(req *client.UpdateCommandRequest) (*string, error) {
	if req.StepsJson != nil {
		steps := *req.StepsJson
		return &steps, nil
	}
	if req.ActionsJson == "" {
		return nil, nil
	}
	chained, err := chainActions(req.ActionsJson)
	if err != nil {
		return nil, twirp.InvalidArgumentError("actions_json", err.Error())
	}
	return &chained, nil
}

// LinkCommandWorkflows gives every command that still runs its own action
// list a workflow holding those actions, run in order, and links the command
// to it. db-proxy runs it on every start, so a database from before commands
// had workflows is converted on upgrade, and running it again finds nothing
// left to do.
//
// Each command is converted in a transaction of its own. One that fails is
// logged and left exactly as it was: it keeps running its actions without a
// workflow, and the next start tries it again.
func (s *commandService) LinkCommandWorkflows(logger *slog.Logger) (linked int, failed int) {
	commands, err := s.repo.GetUnlinked()
	if err != nil {
		logger.Error("List commands to link to workflows", "error", err)
		return 0, 0
	}
	for _, cmd := range commands {
		steps, err := chainActions(cmd.Actions)
		if err == nil {
			var count int
			count, err = countSteps(steps)
			if err == nil && count == 0 {
				continue
			}
		}
		var change *commandWorkflowChange
		if err == nil {
			err = s.repo.Transaction(func(tx *gorm.DB) error {
				var err error
				change, err = setCommandSteps(tx, cmd, steps)
				if err != nil {
					return err
				}
				if err := tx.Save(cmd).Error; err != nil {
					return err
				}
				return change.announceIn(tx, s.publisher)
			})
		}
		if err != nil {
			logger.Warn("Command keeps running its actions without a workflow",
				"command", cmd.Command, "id", cmd.ID, "error", err)
			failed++
			continue
		}

		linked++
		change.syncEdges(s.refRepo)
		s.syncCommandEdges(cmd, cmd.Actions, cmd.CreatedByType, cmd.CreatedByRef)
		// The link is committed and the workflow announced. Without the command's
		// own event the UI catches up at its next full sync of commands.
		protoCmd, err := s.toProtoCommand(cmd)
		if err != nil {
			logger.Error("Read back a command linked to its workflow", "id", cmd.ID, "error", err)
			continue
		}
		s.publishChange(protoCmd, "updated")
	}
	return linked, failed
}

func (s *commandService) HasPermission(ctx context.Context, enforcer *casbin.Enforcer, method string, request any) (bool, error) {
	switch method {
	case "GetCommand":
		// The Casbin middleware hands us the raw body as []byte for protobuf
		// callers and a decoded map for JSON ones. Assert rather than panic on
		// the map case - an unexpected shape must fail closed, not crash the
		// whole db-proxy.
		body, ok := request.([]byte)
		if !ok {
			return false, fmt.Errorf("GetCommand permission check requires a protobuf request body, got %T", request)
		}
		var req client.GetCommandRequest
		if err := proto.Unmarshal(body, &req); err != nil {
			return false, err
		}

		username := req.Username
		if username == nil || *username == "" {
			return false, fmt.Errorf("username is required")
		}

		cmd, err := s.repo.GetByCommand(req.Command)
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
