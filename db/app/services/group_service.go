package services

import (
	"context"
	"strings"

	"github.com/casbin/casbin/v2"
	"github.com/google/uuid"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/database/models"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// groupSubject is the Casbin "g" object used for a group grant, e.g.
// "group:<groupId>". Command permission sync (see command_service.go)
// writes p-rules against this same string.
func groupSubject(groupID uuid.UUID) string {
	return "group:" + groupID.String()
}

type groupService struct {
	repo           *repo.GroupRepository
	permissionRepo *repo.PermissionRepository
	enforcer       *casbin.Enforcer
}

func NewGroupService(groupRepo *repo.GroupRepository, permissionRepo *repo.PermissionRepository, enforcer *casbin.Enforcer) *groupService {
	return &groupService{
		repo:           groupRepo,
		permissionRepo: permissionRepo,
		enforcer:       enforcer,
	}
}

func toProtoGroup(g *models.Group) *client.Group {
	return &client.Group{
		Id:            g.ID.String(),
		ApplicationId: g.ApplicationID.String(),
		Name:          g.Name,
		Description:   g.Description,
		CreatedAt:     timestamppb.New(g.CreatedAt),
	}
}

func (s *groupService) CreateGroup(ctx context.Context, req *client.CreateGroupRequest) (*client.GroupResponse, error) {
	appIDStr, err := resolveApplicationID(ctx, s.repo.DB(), req.ApplicationId)
	if err != nil {
		return nil, err
	}
	appID, err := uuid.Parse(appIDStr)
	if err != nil {
		return nil, err
	}

	m := models.Group{
		ApplicationID: appID,
		Name:          strings.TrimSpace(req.Name),
		Description:   req.Description,
	}
	if err := s.repo.Create(&m); err != nil {
		return nil, err
	}

	return &client.GroupResponse{
		Status: &client.ResponseStatus{Code: client.ResponseStatus_OK, Message: "Group created successfully"},
		Group:  toProtoGroup(&m),
	}, nil
}

func (s *groupService) GetGroup(ctx context.Context, req *client.GetGroupRequest) (*client.GroupResponse, error) {
	id, err := uuid.Parse(req.Id)
	if err != nil {
		return nil, err
	}
	m, err := s.repo.GetByID(id)
	if err != nil {
		return nil, err
	}
	return &client.GroupResponse{
		Status: &client.ResponseStatus{Code: client.ResponseStatus_OK, Message: "Group retrieved successfully"},
		Group:  toProtoGroup(m),
	}, nil
}

func (s *groupService) ListGroups(ctx context.Context, req *client.ListGroupsRequest) (*client.ListGroupsResponse, error) {
	appIDStr, err := resolveApplicationID(ctx, s.repo.DB(), req.ApplicationId)
	if err != nil {
		return nil, err
	}
	appID, err := uuid.Parse(appIDStr)
	if err != nil {
		return nil, err
	}

	groups, err := s.repo.GetByApplicationID(appID)
	if err != nil {
		return nil, err
	}
	protoGroups := make([]*client.Group, len(groups))
	for i := range groups {
		protoGroups[i] = toProtoGroup(&groups[i])
	}

	return &client.ListGroupsResponse{
		Status: &client.ResponseStatus{Code: client.ResponseStatus_OK, Message: "Groups retrieved successfully"},
		Groups: protoGroups,
	}, nil
}

func (s *groupService) UpdateGroup(ctx context.Context, req *client.UpdateGroupRequest) (*client.GroupResponse, error) {
	id, err := uuid.Parse(req.Id)
	if err != nil {
		return nil, err
	}
	m, err := s.repo.GetByID(id)
	if err != nil {
		return nil, err
	}
	m.Name = strings.TrimSpace(req.Name)
	m.Description = req.Description
	if err := s.repo.Update(m); err != nil {
		return nil, err
	}
	return &client.GroupResponse{
		Status: &client.ResponseStatus{Code: client.ResponseStatus_OK, Message: "Group updated successfully"},
		Group:  toProtoGroup(m),
	}, nil
}

func (s *groupService) DeleteGroup(ctx context.Context, req *client.DeleteGroupRequest) (*client.ResponseStatus, error) {
	id, err := uuid.Parse(req.Id)
	if err != nil {
		return nil, err
	}
	m, err := s.repo.GetByID(id)
	if err != nil {
		return nil, err
	}
	if err := s.repo.Delete(m); err != nil {
		return nil, err
	}
	return &client.ResponseStatus{Code: client.ResponseStatus_OK, Message: "Group deleted successfully"}, nil
}

func (s *groupService) AddUserToGroup(ctx context.Context, req *client.GroupMembershipRequest) (*client.ResponseStatus, error) {
	appIDStr, err := resolveApplicationID(ctx, s.repo.DB(), req.ApplicationId)
	if err != nil {
		return nil, err
	}
	appID, err := uuid.Parse(appIDStr)
	if err != nil {
		return nil, err
	}
	groupID, err := uuid.Parse(req.GroupId)
	if err != nil {
		return nil, err
	}
	username := strings.ToLower(strings.TrimSpace(req.Username))

	if err := s.repo.AddMember(groupID, username); err != nil {
		return nil, err
	}
	if err := s.permissionRepo.AddGrouping(appID, username, groupSubject(groupID)); err != nil {
		return nil, err
	}
	if err := s.enforcer.LoadPolicy(); err != nil {
		return nil, err
	}

	return &client.ResponseStatus{Code: client.ResponseStatus_OK, Message: "User added to group successfully"}, nil
}

func (s *groupService) RemoveUserFromGroup(ctx context.Context, req *client.GroupMembershipRequest) (*client.ResponseStatus, error) {
	appIDStr, err := resolveApplicationID(ctx, s.repo.DB(), req.ApplicationId)
	if err != nil {
		return nil, err
	}
	appID, err := uuid.Parse(appIDStr)
	if err != nil {
		return nil, err
	}
	groupID, err := uuid.Parse(req.GroupId)
	if err != nil {
		return nil, err
	}
	username := strings.ToLower(strings.TrimSpace(req.Username))

	if err := s.repo.RemoveMember(groupID, username); err != nil {
		return nil, err
	}
	if err := s.permissionRepo.RemoveGrouping(appID, username, groupSubject(groupID)); err != nil {
		return nil, err
	}
	if err := s.enforcer.LoadPolicy(); err != nil {
		return nil, err
	}

	return &client.ResponseStatus{Code: client.ResponseStatus_OK, Message: "User removed from group successfully"}, nil
}

func (s *groupService) ListGroupMembers(ctx context.Context, req *client.ListGroupMembersRequest) (*client.ListGroupMembersResponse, error) {
	groupID, err := uuid.Parse(req.GroupId)
	if err != nil {
		return nil, err
	}
	usernames, err := s.repo.ListMembers(groupID)
	if err != nil {
		return nil, err
	}
	return &client.ListGroupMembersResponse{
		Status:    &client.ResponseStatus{Code: client.ResponseStatus_OK, Message: "Group members retrieved successfully"},
		Usernames: usernames,
	}, nil
}

func (s *groupService) ListUserGroupsForUser(ctx context.Context, req *client.ListUserGroupsForUserRequest) (*client.ListGroupsResponse, error) {
	appIDStr, err := resolveApplicationID(ctx, s.repo.DB(), req.ApplicationId)
	if err != nil {
		return nil, err
	}
	appID, err := uuid.Parse(appIDStr)
	if err != nil {
		return nil, err
	}
	username := strings.ToLower(strings.TrimSpace(req.Username))

	groups, err := s.repo.ListGroupsForUser(appID, username)
	if err != nil {
		return nil, err
	}
	protoGroups := make([]*client.Group, len(groups))
	for i := range groups {
		protoGroups[i] = toProtoGroup(&groups[i])
	}

	return &client.ListGroupsResponse{
		Status: &client.ResponseStatus{Code: client.ResponseStatus_OK, Message: "User groups retrieved successfully"},
		Groups: protoGroups,
	}, nil
}

// HasPermission gates GroupService's own RPCs. Group/command management is
// not access-controlled by Casbin - the api service already authenticates
// its callers via its own token auth, and Casbin here exists purely to
// answer "can this chat user invoke this command" (and similar future
// event-bus-driven checks), not to gate management endpoints.
func (s *groupService) HasPermission(ctx context.Context, enforcer *casbin.Enforcer, method string, request any) (bool, error) {
	return true, nil
}
