package services

import (
	"context"

	"github.com/google/uuid"
	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/app/workers"
	"github.com/wolfymaster/woofx3/db/database/models"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// UserService represents the business logic for Users
type UserService struct {
	repo      *repo.UserRepository
	publisher *workers.EventPublisher
}

// NewUserService creates a new instance of UserService
func NewUserService(repo *repo.UserRepository, publisher *workers.EventPublisher) client.UserService {
	return &UserService{
		repo:      repo,
		publisher: publisher,
	}
}

// CreateUser creates a new user in the database
func (s *UserService) CreateUser(ctx context.Context, req *client.CreateUserRequest) (*client.UserResponse, error) {
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

	if s.publisher != nil {
		s.publisher.Publish(workers.PublishOptions{
			ApplicationID:   "default",
			EntityType:      "user",
			EntityID:        user.ID,
			Operation:       "created",
			Data:            user,
			AutoAcknowledge: true,
		})
	}

	return &client.UserResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "User created successfully",
		},
		User: userToProto(user),
	}, nil
}

// GetUser retrieves a user by ID
func (s *UserService) GetUser(ctx context.Context, req *client.GetUserRequest) (*client.UserResponse, error) {
	user, err := s.repo.GetByID(req.Id)
	if err != nil {
		return nil, twirp.NotFoundError("user not found")
	}

	return &client.UserResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "User retrieved successfully",
		},
		User: userToProto(user),
	}, nil
}

// UpdateUser updates an existing user
func (s *UserService) UpdateUser(ctx context.Context, req *client.UpdateUserRequest) (*client.UserResponse, error) {
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

	return &client.UserResponse{
		Status: &client.ResponseStatus{
			Code:    client.ResponseStatus_OK,
			Message: "User updated successfully",
		},
		User: userToProto(user),
	}, nil
}

// DeleteUser deletes a user from the database
func (s *UserService) DeleteUser(ctx context.Context, req *client.DeleteUserRequest) (*client.ResponseStatus, error) {
	user, err := s.repo.GetByID(req.Id)
	if err != nil {
		return nil, twirp.NotFoundError("user not found")
	}

	err = s.repo.Delete(user)
	if err != nil {
		return nil, twirp.InternalErrorWith(err)
	}

	return &client.ResponseStatus{
		Code:    client.ResponseStatus_OK,
		Message: "User deleted successfully",
	}, nil
}

// Helper function to convert database model to protobuf message
func userToProto(user *models.User) *client.User {
	var createdAt, updatedAt *timestamppb.Timestamp
	if !user.CreatedAt.IsZero() {
		createdAt = timestamppb.New(user.CreatedAt)
	}
	if !user.UpdatedAt.IsZero() {
		updatedAt = timestamppb.New(user.UpdatedAt)
	}

	return &client.User{
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
