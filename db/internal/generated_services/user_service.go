package services

// import (
// 	"context"
// 	"errors"
// 	"fmt"
// 	"time"

// 	"gorm.io/gorm"
// 	"github.com/google/uuid"
// 	"golang.org/x/crypto/bcrypt"
	
// 	"github.com/wolfymaster/woofx3/db/models"
// )

// type userService struct {
// 	baseService[models.User]
// 	permissionService PermissionService
// }

// // NewUserService creates a new instance of UserService
// func NewUserService(permissionService PermissionService) UserService {
// 	return &userService{
// 		baseService:      baseService[models.User]{},
// 		permissionService: permissionService,
// 	}
// }

// // Create creates a new user with hashed password
// func (s *userService) Create(db *gorm.DB, user *models.User) error {
// 	// Hash password before saving
// 	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(user.Password), bcrypt.DefaultCost)
// 	if err != nil {
// 		return fmt.Errorf("failed to hash password: %w", err)
// 	}

// 	user.Password = string(hashedPassword)
// 	user.CreatedAt = time.Now()
// 	user.UpdatedAt = time.Now()

// 	return s.baseService.Create(db, user)
// }

// // Update updates an existing user
// func (s *userService) Update(db *gorm.DB, user *models.User) error {
// 	user.UpdatedAt = time.Now()
// 	return s.baseService.Update(db, user)
// }

// // GetByUsername retrieves a user by their username
// func (s *userService) GetByUsername(db *gorm.DB, username string) (*models.User, error) {
// 	var user models.User
// 	err := db.First(&user, "username = ?", username).Error
// 	if err != nil {
// 		if errors.Is(err, gorm.ErrRecordNotFound) {
// 			return nil, fmt.Errorf("user not found")
// 		}
// 		return nil, fmt.Errorf("failed to get user: %w", err)
// 	}

// 	return &user, nil
// }

// // UpdatePassword updates a user's password
// func (s *userService) UpdatePassword(db *gorm.DB, userID uuid.UUID, newPassword string) error {
// 	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
// 	if err != nil {
// 		return fmt.Errorf("failed to hash password: %w", err)
// 	}

// 	return db.Model(&models.User{}).
// 		Where("id = ?", userID).
// 		Update("password", string(hashedPassword)).
// 		Error
// }

// // ListUsers retrieves a paginated list of users
// func (s *userService) ListUsers(db *gorm.DB, page, pageSize int) ([]models.User, int64, error) {
// 	return s.baseService.List(db, page, pageSize)
// }

// // Authenticate verifies user credentials and returns the user if valid
// func (s *userService) Authenticate(ctx context.Context, db *gorm.DB, username, password string) (*models.User, error) {
// 	user, err := s.GetByUsername(db, username)
// 	if err != nil {
// 		return nil, fmt.Errorf("authentication failed: %w", err)
// 	}

// 	// Verify password
// 	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(password)); err != nil {
// 		return nil, fmt.Errorf("invalid credentials")
// 	}

// 	return user, nil
// }

// // HasPermission checks if a user has a specific permission
// func (s *userService) HasPermission(ctx context.Context, db *gorm.DB, userID uuid.UUID, resource, action string) (bool, error) {
// 	user, err := s.GetByID(db, userID)
// 	if err != nil {
// 		return false, fmt.Errorf("failed to get user: %w", err)
// 	}

// 	// Check direct permissions
// 	directPermission := fmt.Sprintf("%s:%s", resource, action)
// 	hasPermission, err := s.permissionService.Authorize(db, userID, resource, action)
// 	if err != nil {
// 		return false, fmt.Errorf("failed to check permission: %w", err)
// 	}

// 	return hasPermission, nil
// }
