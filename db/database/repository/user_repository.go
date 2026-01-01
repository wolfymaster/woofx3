package repository

import (
	"github.com/wolfymaster/woofx3/db/database/models"
	"gorm.io/gorm"
)

// UserRepository represents the db functions for Users
type UserRepository struct {
	db *gorm.DB
}

// NewUserRepository returns a new instance of UserRepository
func NewUserRepository(db *gorm.DB) *UserRepository {
	return &UserRepository{db: db}
}

// Create creates a new User
func (r *UserRepository) Create(user *models.User) error {
	return r.db.Create(user).Error
}

// Update updates a User
func (r *UserRepository) Update(user *models.User) error {
	return r.db.Save(user).Error
}

// Delete deletes a User
func (r *UserRepository) Delete(user *models.User) error {
	return r.db.Delete(user).Error
}

// GetByID retrieves a User by ID
func (r *UserRepository) GetByID(id string) (*models.User, error) {
	var user models.User
	err := r.db.Where("id = ?", id).First(&user).Error
	return &user, err
}

// GetByUserID retrieves a User by their platform user ID
func (r *UserRepository) GetByUserID(userID string, platform string) (*models.User, error) {
	var user models.User
	err := r.db.Where("user_id = ? AND platform = ?", userID, platform).First(&user).Error
	return &user, err
}

// GetAll retrieves all Users
func (r *UserRepository) GetAll() ([]*models.User, error) {
	var users []*models.User
	err := r.db.Find(&users).Error
	return users, err
}
