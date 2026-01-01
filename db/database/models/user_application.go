package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// UserApplication represents the many-to-many relationship between users and applications
type UserApplication struct {
	ID            uuid.UUID `gorm:"type:uuid;default:uuid_generate_v4();primaryKey" json:"id"`
	UserID        int       `gorm:"not null;index:idx_user_app_unique,unique;index:idx_user_app_user" json:"user_id"`
	ApplicationID uuid.UUID `gorm:"type:uuid;not null;index:idx_user_app_application;index:idx_user_app_unique,unique" json:"application_id"`
	Role          string    `gorm:"type:varchar(50);not null" json:"role"`
	CreatedAt     time.Time `gorm:"not null;default:now()" json:"created_at"`

	// Relationships
	User        User        `gorm:"foreignKey:UserID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE"`
	Application Application `gorm:"foreignKey:ApplicationID;references:ID;constraint:OnUpdate:CASCADE,OnDelete:CASCADE"`
}

// TableName specifies the table name for the UserApplication model
func (UserApplication) TableName() string {
	return "user_applications"
}

// Create creates a new user-application association
func (ua *UserApplication) Create(db *gorm.DB) error {
	return db.Create(ua).Error
}

// Update updates the user-application association
func (ua *UserApplication) Update(db *gorm.DB) error {
	return db.Save(ua).Error
}

// Delete removes the user-application association
func (ua *UserApplication) Delete(db *gorm.DB) error {
	return db.Delete(ua).Error
}

// GetUserApplication retrieves a user-application association by user ID and application ID
func GetUserApplication(db *gorm.DB, userID int, applicationID uuid.UUID) (*UserApplication, error) {
	var userApp UserApplication
	err := db.Where("user_id = ? AND application_id = ?", userID, applicationID).First(&userApp).Error
	return &userApp, err
}

// GetUserApplications retrieves all applications for a user
func GetUserApplications(db *gorm.DB, userID int) ([]UserApplication, error) {
	var userApps []UserApplication
	err := db.Where("user_id = ?", userID).Find(&userApps).Error
	return userApps, err
}

// GetApplicationUsers retrieves all users for an application
func GetApplicationUsers(db *gorm.DB, applicationID uuid.UUID) ([]UserApplication, error) {
	var userApps []UserApplication
	err := db.Preload("User").Where("application_id = ?", applicationID).Find(&userApps).Error
	return userApps, err
}

// UpdateUserRole updates a user's role for a specific application
func UpdateUserRole(db *gorm.DB, userID int, applicationID uuid.UUID, role string) error {
	return db.Model(&UserApplication{}).
		Where("user_id = ? AND application_id = ?", userID, applicationID).
		Update("role", role).
		Error
}

// UserHasAccess checks if a user has access to an application with at least the specified role
func UserHasAccess(db *gorm.DB, userID int, applicationID uuid.UUID, minRole string) (bool, error) {
	var count int64
	err := db.Model(&UserApplication{}).
		Where("user_id = ? AND application_id = ? AND role >= ?", userID, applicationID, minRole).
		Count(&count).Error

	return count > 0, err
}
