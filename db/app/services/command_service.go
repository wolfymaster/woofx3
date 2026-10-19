package services

import (
	"context"
	"errors"
	"fmt"
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
	logger     *slog.Logger
}

func NewCommandService(
	cmdRepo *repo.CommandRepository,
	refRepo *repo.ResourceReferenceRepository,
	permRepo *repo.CommandPermissionRepository,
	casbinRepo *repo.PermissionRepository,
	groupRepo *repo.GroupRepository,
	enforcer *casbin.Enforcer,
	publisher *workers.EventPublisher,
	logger *slog.Logger,
) *commandService {
	return &commandService{
		repo:       cmdRepo,
		refRepo:    refRepo,
		permRepo:   permRepo,
		casbinRepo: casbinRepo,
		groupRepo:  groupRepo,
		enforcer:   enforcer,
		publisher:  publisher,
		logger:     logger,
	}
}

// writeCommandPermissions re-derives command_groups/command_users and the
// Casbin p-rows for a command from scratch, inside tx. Called on every
// create/update so the join tables and the policy rows never drift; the
// caller reloads the enforcer once tx commits, since the enforcer reads the
// policy outside it. Public commands never get Casbin rows - visibility is
// checked in application code (woofwoofwoof) before Casbin is ever consulted.
func (s *commandService) writeCommandPermissions(tx *gorm.DB, cmd *models.Command, groupIDStrs, usernames []string) error {
	groupIDs := make([]uuid.UUID, 0, len(groupIDStrs))
	for _, idStr := range groupIDStrs {
		id, err := uuid.Parse(idStr)
		if err != nil {
			return &invalidArgument{"group_ids", fmt.Errorf("invalid group id %q: %w", idStr, err)}
		}
		groupIDs = append(groupIDs, id)
	}

	permRepo := s.permRepo.WithDB(tx)
	casbinRepo := s.casbinRepo.WithDB(tx)
	if err := permRepo.ReplaceGroups(cmd.ID, groupIDs); err != nil {
		return err
	}
	if err := permRepo.ReplaceUsers(cmd.ID, usernames); err != nil {
		return err
	}

	object := "command/" + cmd.Command
	if err := casbinRepo.RemoveAllPTypeForObject(object); err != nil {
		return err
	}
	if cmd.Visibility != commandVisibilityRestricted {
		return nil
	}
	// No group and no user grant means no restriction was configured, not
	// "deny everyone". Say so positively in the policy data with the
	// wildcard subject so every enforcement path agrees; leaving the object
	// with zero rules would deny it everywhere instead.
	if len(groupIDs) == 0 && len(usernames) == 0 {
		return casbinRepo.AddPType(models.WildcardSubject, object, "read", "allow")
	}

	everyoneIDs, err := s.everyoneGroupIDs(tx, groupIDs)
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
		if err := casbinRepo.AddPType(subject, object, "read", "allow"); err != nil {
			return err
		}
	}
	for _, username := range usernames {
		if err := casbinRepo.AddPType(username, object, "read", "allow"); err != nil {
			return err
		}
	}
	return nil
}

// reloadPolicy makes the enforcer see the policy rows a committed write
// changed.
func (s *commandService) reloadPolicy() error {
	if err := s.enforcer.LoadPolicy(); err != nil {
		return fmt.Errorf("reload command permissions: %w", err)
	}
	return nil
}

// everyoneGroupIDs reports which of the given ids are the built-in "everyone"
// group. Returns an empty set when no group repository is wired, so callers
// degrade to plain group subjects rather than failing.
func (s *commandService) everyoneGroupIDs(tx *gorm.DB, groupIDs []uuid.UUID) (map[uuid.UUID]bool, error) {
	out := make(map[uuid.UUID]bool)
	if s.groupRepo == nil || len(groupIDs) == 0 {
		return out, nil
	}
	groups, err := s.groupRepo.WithDB(tx).GetByIDs(groupIDs)
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
		s.logger.Error("Replace the edges of a command", "id", cmd.ID, "error", err)
	}
}

// commandProto is commandProtos for one command.
func (s *commandService) commandProto(db *gorm.DB, cmd *models.Command) (*client.Command, error) {
	protos, err := s.commandProtos(db, []*models.Command{cmd})
	if err != nil {
		return nil, err
	}
	return protos[0], nil
}

// commandProtos converts persisted commands into the wire shape, reading
// through db (a transaction, when the caller is in one). Their group/user
// grants live in join tables and their steps in their workflows, so each of
// those is loaded once for all of cmds rather than once per command.
func (s *commandService) commandProtos(db *gorm.DB, cmds []*models.Command) ([]*client.Command, error) {
	ids := make([]uuid.UUID, len(cmds))
	var workflowIDs []uuid.UUID
	for i, cmd := range cmds {
		ids[i] = cmd.ID
		if cmd.WorkflowID != nil {
			workflowIDs = append(workflowIDs, *cmd.WorkflowID)
		}
	}
	permRepo := s.permRepo.WithDB(db)
	groupIDs, err := permRepo.GroupIDsByCommand(ids)
	if err != nil {
		return nil, fmt.Errorf("list command groups: %w", err)
	}
	usernames, err := permRepo.UsernamesByCommand(ids)
	if err != nil {
		return nil, fmt.Errorf("list command users: %w", err)
	}
	workflows := make(map[uuid.UUID]*models.WorkflowDefinition, len(workflowIDs))
	if len(workflowIDs) > 0 {
		var rows []*models.WorkflowDefinition
		if err := db.Where("id IN ?", workflowIDs).Find(&rows).Error; err != nil {
			return nil, fmt.Errorf("list command workflows: %w", err)
		}
		for _, wf := range rows {
			workflows[wf.ID] = wf
		}
	}

	out := make([]*client.Command, len(cmds))
	for i, cmd := range cmds {
		workflowID, stepsJSON, workflowError := "", "[]", cmd.WorkflowError
		if cmd.WorkflowID != nil {
			if wf, ok := workflows[*cmd.WorkflowID]; ok {
				workflowID, stepsJSON = wf.ID.String(), wf.Steps
			} else {
				s.logger.Error("Command links to a workflow that no longer exists",
					"command", cmd.Command, "id", cmd.ID, "workflow_id", *cmd.WorkflowID)
				workflowError = fmt.Sprintf("%s (%s)", errLinkedWorkflowMissing, *cmd.WorkflowID)
			}
		}
		groupIDStrs := make([]string, len(groupIDs[cmd.ID]))
		for j, id := range groupIDs[cmd.ID] {
			groupIDStrs[j] = id.String()
		}
		out[i] = &client.Command{
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
			Usernames:       usernames[cmd.ID],
			ArgumentPattern: cmd.ArgumentPattern,
			WorkflowId:      workflowID,
			StepsJson:       stepsJSON,
			WorkflowError:   workflowError,
		}
		if out[i].Usernames == nil {
			out[i].Usernames = []string{}
		}
	}
	return out, nil
}

// publishCommandIn announces a command row change on the outbox inside tx, so
// the event goes out exactly when the change commits. The api projects it
// onto the UI's command webhooks, which is the only way the UI hears about
// commands written by something other than the api's own command routes --
// barkloader registering a module's commands, or db-proxy linking a command
// to its workflow at start.
func (s *commandService) publishCommandIn(tx *gorm.DB, cmd *client.Command, op string) error {
	if s.publisher == nil {
		return nil
	}
	return s.publisher.PublishIn(tx, workers.PublishOptions{
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
		"workflow_error":   cmd.WorkflowError,
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
			protoCmd, err := s.commandProto(s.repo.DB(), existing)
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
	var protoCmd *client.Command
	err := s.repo.Transaction(func(tx *gorm.DB) error {
		// Inserted before its steps are written: the workflow is linked to the
		// row with a conditional UPDATE.
		if err := tx.Create(&m).Error; err != nil {
			return err
		}
		var err error
		change, err = s.setCommandSteps(tx, &m, steps)
		if err != nil {
			return err
		}
		if err := tx.Save(&m).Error; err != nil {
			return err
		}
		if err := s.writeCommandPermissions(tx, &m, cmd.GroupIds, cmd.Usernames); err != nil {
			return err
		}
		if protoCmd, err = s.commandProto(tx, &m); err != nil {
			return err
		}
		if err := change.announceIn(tx, s.publisher); err != nil {
			return err
		}
		return s.publishCommandIn(tx, protoCmd, "created")
	})
	if err != nil {
		return nil, twirpError(err)
	}
	if err := s.reloadPolicy(); err != nil {
		return nil, err
	}

	change.syncEdges(s.refRepo, s.logger)
	s.syncCommandEdges(&m, m.Actions, m.CreatedByType, m.CreatedByRef)

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

	protoCmd, err := s.commandProto(s.repo.DB(), cmd)
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

	protoCommands, err := s.commandProtos(s.repo.DB(), commands)
	if err != nil {
		return nil, err
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
	commandID, err := uuid.Parse(req.Id)
	if err != nil {
		return nil, twirp.InvalidArgumentError("id", "invalid UUID format")
	}

	steps, err := updatedCommandSteps(req)
	if err != nil {
		return nil, err
	}

	var m *models.Command
	var change *commandWorkflowChange
	var protoCmd *client.Command
	err = s.repo.Transaction(func(tx *gorm.DB) error {
		var err error
		m, err = lockCommand(s.repo.WithDB(tx), commandID)
		if err != nil {
			return err
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

		switch {
		case steps != nil:
			change, err = s.setCommandSteps(tx, m, *steps)
		case oldCommandName != m.Command:
			change, err = s.renameCommandWorkflow(tx, m)
		}
		if err != nil {
			return err
		}
		if err := tx.Save(m).Error; err != nil {
			return err
		}

		// A rename changes the "command/<name>" Casbin object string - clear
		// the old object's rows too, since writeCommandPermissions only
		// re-derives under the (possibly new) current name.
		if oldCommandName != m.Command {
			if err := s.casbinRepo.WithDB(tx).RemoveAllPTypeForObject("command/" + oldCommandName); err != nil {
				return err
			}
		}
		if err := s.writeCommandPermissions(tx, m, req.GroupIds, req.Usernames); err != nil {
			return err
		}
		if protoCmd, err = s.commandProto(tx, m); err != nil {
			return err
		}
		if err := change.announceIn(tx, s.publisher); err != nil {
			return err
		}
		return s.publishCommandIn(tx, protoCmd, "updated")
	})
	if err != nil {
		return nil, twirpError(err)
	}
	if err := s.reloadPolicy(); err != nil {
		return nil, err
	}

	change.syncEdges(s.refRepo, s.logger)
	s.syncCommandEdges(m, m.Actions, m.CreatedByType, m.CreatedByRef)

	return &client.CommandResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Command updated successfully",
		},
		Command: protoCmd,
	}, nil
}

func (s *commandService) DeleteCommand(ctx context.Context, req *client.DeleteCommandRequest) (*client.ResponseStatus, error) {
	commandID, err := uuid.Parse(req.Id)
	if err != nil {
		return nil, twirp.InvalidArgumentError("id", "invalid UUID format")
	}

	var m *models.Command
	var change *commandWorkflowChange
	err = s.repo.Transaction(func(tx *gorm.DB) error {
		var err error
		m, err = lockCommand(s.repo.WithDB(tx), commandID)
		if err != nil {
			return err
		}
		change, err = s.setCommandSteps(tx, m, "[]")
		if err != nil {
			return err
		}
		if err := s.permRepo.WithDB(tx).DeleteBySourceCommand(m.ID); err != nil {
			return err
		}
		if err := s.casbinRepo.WithDB(tx).RemoveAllPTypeForObject("command/" + m.Command); err != nil {
			return err
		}
		if err := tx.Delete(m).Error; err != nil {
			return err
		}
		if err := change.announceIn(tx, s.publisher); err != nil {
			return err
		}
		if s.publisher == nil {
			return nil
		}
		return s.publisher.PublishIn(tx, workers.PublishOptions{
			EntityType:      "command",
			EntityID:        m.ID.String(),
			Operation:       "deleted",
			Data:            map[string]any{"id": m.ID.String(), "command": m.Command},
			AutoAcknowledge: true,
		})
	})
	if err != nil {
		return nil, twirpError(err)
	}
	if err := s.reloadPolicy(); err != nil {
		return nil, err
	}
	change.syncEdges(s.refRepo, s.logger)

	if s.refRepo != nil {
		if err := s.refRepo.DeleteEdgesBySource("command", m.ID); err != nil {
			s.logger.Error("Delete the edges of a deleted command", "id", m.ID, "error", err)
		}
	}

	return &client.ResponseStatus{
		Code:    client.ResponseStatus_OK,
		Message: "Command deleted successfully",
	}, nil
}

// lockCommand reads the command with id through commands, which runs on a
// transaction, locking its row until that transaction ends.
func lockCommand(commands *repo.CommandRepository, id uuid.UUID) (*models.Command, error) {
	cmd, err := commands.LockByID(id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, twirp.NotFoundError("command not found")
	}
	if err != nil {
		return nil, fmt.Errorf("read command %s: %w", id, err)
	}
	return cmd, nil
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
// left as it was, keeps running its actions without a workflow, and gets the
// reason as its workflow_error, where the streamer can see it; the next start
// tries it again.
func (s *commandService) LinkCommandWorkflows() (linked int, failed int) {
	commands, err := s.repo.GetUnlinked()
	if err != nil {
		s.logger.Error("List commands to link to workflows", "error", err)
		return 0, 0
	}
	for _, listed := range commands {
		change, cmd, err := s.linkCommandWorkflow(listed.ID)
		if err != nil {
			failed++
			s.logger.Warn("Command keeps running its actions without a workflow",
				"command", listed.Command, "id", listed.ID, "error", err)
			if err := s.recordWorkflowError(listed.ID, err.Error()); err != nil {
				s.logger.Error("Record why a command has no workflow", "id", listed.ID, "error", err)
			}
			continue
		}
		if change == nil {
			continue
		}
		linked++
		change.syncEdges(s.refRepo, s.logger)
		s.syncCommandEdges(cmd, cmd.Actions, cmd.CreatedByType, cmd.CreatedByRef)
	}
	return linked, failed
}

// linkCommandWorkflow converts one command for LinkCommandWorkflows. The
// command is read again, locked, inside the transaction: another db-proxy may
// have linked it since the listing. A nil change is a command with nothing to
// convert.
func (s *commandService) linkCommandWorkflow(id uuid.UUID) (*commandWorkflowChange, *models.Command, error) {
	var change *commandWorkflowChange
	var cmd *models.Command
	err := s.repo.Transaction(func(tx *gorm.DB) error {
		var err error
		cmd, err = lockCommand(s.repo.WithDB(tx), id)
		if err != nil {
			return err
		}
		if cmd.WorkflowID != nil {
			return nil
		}
		steps, err := chainActions(cmd.Actions)
		if err != nil {
			return err
		}
		count, err := countSteps(steps)
		if err != nil {
			return err
		}
		if count == 0 {
			return nil
		}
		if change, err = s.setCommandSteps(tx, cmd, steps); err != nil {
			return err
		}
		if err := tx.Save(cmd).Error; err != nil {
			return err
		}
		protoCmd, err := s.commandProto(tx, cmd)
		if err != nil {
			return err
		}
		if err := change.announceIn(tx, s.publisher); err != nil {
			return err
		}
		return s.publishCommandIn(tx, protoCmd, "updated")
	})
	if err != nil {
		return nil, nil, err
	}
	return change, cmd, nil
}

// recordWorkflowError stores reason as the command's workflow_error and
// announces the change, unless it already says exactly that: the same failure
// is retried on every start, and only a new reason is news.
func (s *commandService) recordWorkflowError(id uuid.UUID, reason string) error {
	return s.repo.Transaction(func(tx *gorm.DB) error {
		commands := s.repo.WithDB(tx)
		cmd, err := lockCommand(commands, id)
		if err != nil {
			return err
		}
		if cmd.WorkflowError == reason {
			return nil
		}
		if err := commands.SetWorkflowError(id, reason); err != nil {
			return err
		}
		cmd.WorkflowError = reason
		protoCmd, err := s.commandProto(tx, cmd)
		if err != nil {
			return err
		}
		return s.publishCommandIn(tx, protoCmd, "updated")
	})
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
