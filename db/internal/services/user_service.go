package services

import (
	"context"

	"github.com/google/uuid"
	"github.com/twitchtv/twirp"
	rpc "github.com/wolfymaster/woofx3/db/gen/go"
	"github.com/wolfymaster/woofx3/db/internal/database/models"
	repo "github.com/wolfymaster/woofx3/db/internal/database/repository"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// UserService represents the business logic for Users
type UserService struct {
	repo *repo.UserRepository
}

// NewUserService creates a new instance of UserService
func NewUserService(repo *repo.UserRepository) rpc.UserService {
	return &UserService{repo: repo}
}

// CreateUser creates a new user in the database
func (s *UserService) CreateUser(ctx context.Context, req *rpc.CreateUserRequest) (*rpc.UserResponse, error) {
	// Generate a new UUID for the user
	id := uuid.New().String()

	user := &models.User{
		ID:       id,
		Username: req.Username,
		UserID:   req.UserId,
		Platform: req.Platform,
	}

	err := s.repo.Create(user)
	if err != nil {
		return nil, twirp.InternalErrorWith(err)
	}

	return &rpc.UserResponse{
		Status: &rpc.ResponseStatus{
			Code:    rpc.ResponseStatus_OK,
			Message: "User created successfully",
		},
		User: userToProto(user),
	}, nil
}

// GetUser retrieves a user by ID
func (s *UserService) GetUser(ctx context.Context, req *rpc.GetUserRequest) (*rpc.UserResponse, error) {
	user, err := s.repo.GetByID(req.Id)
	if err != nil {
		return nil, twirp.NotFoundError("user not found")
	}

	return &rpc.UserResponse{
		Status: &rpc.ResponseStatus{
			Code:    rpc.ResponseStatus_OK,
			Message: "User retrieved successfully",
		},
		User: userToProto(user),
	}, nil
}

// UpdateUser updates an existing user
func (s *UserService) UpdateUser(ctx context.Context, req *rpc.UpdateUserRequest) (*rpc.UserResponse, error) {
	user, err := s.repo.GetByID(req.Id)
	if err != nil {
		return nil, twirp.NotFoundError("user not found")
	}

	// Update fields
	user.Username = req.Username
	user.Platform = req.Platform

	err = s.repo.Update(user)
	if err != nil {
		return nil, twirp.InternalErrorWith(err)
	}

	return &rpc.UserResponse{
		Status: &rpc.ResponseStatus{
			Code:    rpc.ResponseStatus_OK,
			Message: "User updated successfully",
		},
		User: userToProto(user),
	}, nil
}

// DeleteUser deletes a user from the database
func (s *UserService) DeleteUser(ctx context.Context, req *rpc.DeleteUserRequest) (*rpc.ResponseStatus, error) {
	user, err := s.repo.GetByID(req.Id)
	if err != nil {
		return nil, twirp.NotFoundError("user not found")
	}

	err = s.repo.Delete(user)
	if err != nil {
		return nil, twirp.InternalErrorWith(err)
	}

	return &rpc.ResponseStatus{
		Code:    rpc.ResponseStatus_OK,
		Message: "User deleted successfully",
	}, nil
}

// Helper function to convert database model to protobuf message
func userToProto(user *models.User) *rpc.User {
	var createdAt, updatedAt *timestamppb.Timestamp
	if !user.CreatedAt.IsZero() {
		createdAt = timestamppb.New(user.CreatedAt)
	}
	if !user.UpdatedAt.IsZero() {
		updatedAt = timestamppb.New(user.UpdatedAt)
	}

	return &rpc.User{
		Id:        user.ID,
		Username:  user.Username,
		UserId:    user.UserID,
		Platform:  user.Platform,
		CreatedAt: createdAt,
		UpdatedAt: updatedAt,
	}
}

// GetUserByUserID retrieves a user by their platform user ID
func (s *UserService) GetUserByUserID(ctx context.Context, userID string, platformID string) (*models.User, error) {
	return s.repo.GetByUserID(userID, platformID)
}
