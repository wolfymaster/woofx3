package services

import (
	"context"

	"github.com/casbin/casbin/v2"
	"github.com/google/uuid"

	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/app/types"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
)

type permissionService struct {
	app            *types.App
	CasbinEnforcer *casbin.Enforcer
	repo           *repo.PermissionRepository
}

func NewPermissionService(app *types.App, repo *repo.PermissionRepository, enforcer *casbin.Enforcer) *permissionService {
	return &permissionService{
		app:            app,
		CasbinEnforcer: enforcer,
		repo:           repo,
	}
}

func (s *permissionService) GetEnforcer() *casbin.Enforcer {
	return s.CasbinEnforcer
}

func (s *permissionService) HasPermission(ctx context.Context, req *client.HasPermissionRequest) (*client.ResponseStatus, error) {
	s.app.Logger.Info("Evaluating Permission", "UserName", req.Username, "Resource", req.Resource, "Action", req.Action)

	ok, err := s.CasbinEnforcer.Enforce(req.Username, req.Resource, req.Action)
	if err != nil {
		return nil, err
	}

	s.app.Logger.Info("Permission Decision", "UserName", req.Username, "Decision", ok)

	if ok {
		return &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "Permission granted",
		}, nil
	}

	return &client.ResponseStatus{
		Code:    client.ResponseStatus_PERMISSION_DENIED,
		Message: "Permission denied",
	}, nil
}

// Add Permission Methods

func (s *permissionService) AddPermission(ctx context.Context, req *client.PermissionRequest) (*client.ResponseStatus, error) {
	return s.handleAddPermissionRequest(req)
}

func (s *permissionService) AddUserToResource(ctx context.Context, req *client.UserResourceRoleRequest) (*client.ResponseStatus, error) {
	return s.handleAddUserResourceRoleRequest(req)
}

func (s *permissionService) AddUserToGroup(ctx context.Context, req *client.UserResourceRoleRequest) (*client.ResponseStatus, error) {
	return s.handleAddUserResourceRoleRequest(req)
}

func (s *permissionService) AddUserToRole(ctx context.Context, req *client.UserResourceRoleRequest) (*client.ResponseStatus, error) {
	return s.handleAddUserResourceRoleRequest(req)
}

func (s *permissionService) AddRoleToGroup(ctx context.Context, req *client.UserResourceRoleRequest) (*client.ResponseStatus, error) {
	return s.handleAddUserResourceRoleRequest(req)
}

func (s *permissionService) AddGroupToResource(ctx context.Context, req *client.UserResourceRoleRequest) (*client.ResponseStatus, error) {
	return s.handleAddUserResourceRoleRequest(req)
}

// Remove Permission Methods

func (s *permissionService) RemovePermission(ctx context.Context, req *client.PermissionRequest) (*client.ResponseStatus, error) {
	return s.handleRemovePermissionRequest(req)
}

func (s *permissionService) RemoveUserFromResource(ctx context.Context, req *client.UserResourceRoleRequest) (*client.ResponseStatus, error) {
	return s.handleRemoveUserResourceRoleRequest(req)
}

func (s *permissionService) RemoveUserFromGroup(ctx context.Context, req *client.UserResourceRoleRequest) (*client.ResponseStatus, error) {
	return s.handleRemoveUserResourceRoleRequest(req)
}

func (s *permissionService) RemoveUserFromRole(ctx context.Context, req *client.UserResourceRoleRequest) (*client.ResponseStatus, error) {
	return s.handleRemoveUserResourceRoleRequest(req)
}

func (s *permissionService) RemoveRoleFromGroup(ctx context.Context, req *client.UserResourceRoleRequest) (*client.ResponseStatus, error) {
	return s.handleRemoveUserResourceRoleRequest(req)
}

func (s *permissionService) RemoveGroupFromResource(ctx context.Context, req *client.UserResourceRoleRequest) (*client.ResponseStatus, error) {
	return s.handleRemoveUserResourceRoleRequest(req)
}

/*
handleAddUserResourceRoleRequest is a helper function that handles the user resource role request
*/
func (s *permissionService) handleAddUserResourceRoleRequest(req *client.UserResourceRoleRequest) (*client.ResponseStatus, error) {
	appId, err := uuid.Parse(req.ApplicationId)
	if err != nil {
		return nil, err
	}
	err = s.repo.AddGType(appId, req.Username, req.Resource, req.Role)
	if err != nil {
		return nil, err
	}

	err = s.CasbinEnforcer.LoadPolicy()
	if err != nil {
		return nil, err
	}

	return &client.ResponseStatus{
		Code:    client.ResponseStatus_OK,
		Message: "User added to resource successfully",
	}, nil
}

/*
handleRemoveUserResourceRoleRequest is a helper function that handles the user resource role request
*/
func (s *permissionService) handleRemoveUserResourceRoleRequest(req *client.UserResourceRoleRequest) (*client.ResponseStatus, error) {
	appId, err := uuid.Parse(req.ApplicationId)
	if err != nil {
		return nil, err
	}
	err = s.repo.RemoveGType(appId, req.Username, req.Resource, req.Role)
	if err != nil {
		return nil, err
	}

	err = s.CasbinEnforcer.LoadPolicy()
	if err != nil {
		return nil, err
	}

	return &client.ResponseStatus{
		Code:    client.ResponseStatus_OK,
		Message: "User removed from resource successfully",
	}, nil
}

/*
handleAddPermissionRequest is a helper function that handles the permission request
*/
func (s *permissionService) handleAddPermissionRequest(req *client.PermissionRequest) (*client.ResponseStatus, error) {
	appId, err := uuid.Parse(req.ApplicationId)
	if err != nil {
		return nil, err
	}
	err = s.repo.AddPType(appId, req.Subject, req.Object, req.Action, req.Permission)
	if err != nil {
		return nil, err
	}

	err = s.CasbinEnforcer.LoadPolicy()
	if err != nil {
		return nil, err
	}

	return &client.ResponseStatus{
		Code:    client.ResponseStatus_OK,
		Message: "Permission added successfully",
	}, nil
}

/*
handleRemovePermissionRequest is a helper function that handles the permission request
*/
func (s *permissionService) handleRemovePermissionRequest(req *client.PermissionRequest) (*client.ResponseStatus, error) {
	appId, err := uuid.Parse(req.ApplicationId)
	if err != nil {
		return nil, err
	}
	err = s.repo.RemovePType(appId, req.Subject, req.Object, req.Action, req.Permission)
	if err != nil {
		return nil, err
	}

	err = s.CasbinEnforcer.LoadPolicy()
	if err != nil {
		return nil, err
	}

	return &client.ResponseStatus{
		Code:    client.ResponseStatus_OK,
		Message: "Permission removed successfully",
	}, nil
}
