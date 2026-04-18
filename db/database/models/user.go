package models

import (
	"context"
	"errors"
	"time"

	"github.com/twitchtv/twirp"
	"gorm.io/gorm"
)

type User struct {
	ID             string     `gorm:"primaryKey;type:uuid;default:uuid_generate_v4()"`
	Username       string     `gorm:"type:varchar(50);not null"`
	UserID         string     `gorm:"column:user_id;type:varchar(100);not null;index"`
	Platform       string     `gorm:"type:varchar(50)"`
	Woofx3UIUserID string     `gorm:"column:woofx3_ui_user_id;type:varchar(100);uniqueIndex:idx_users_woofx3_ui_user_id,where:woofx3_ui_user_id IS NOT NULL"`
	DeletedAt      *time.Time `gorm:"column:deleted_at;index"`
	CreatedAt      time.Time  `gorm:"column:created_at;default:CURRENT_TIMESTAMP;not null"`
	UpdatedAt      time.Time  `gorm:"column:updated_at;default:CURRENT_TIMESTAMP;not null"`

	// Relationships
	UserEvents       []UserEvent       `gorm:"foreignKey:UserID;references:ID"`
	UserMeta         []UserMeta        `gorm:"foreignKey:UserID;references:ID"`
	UserApplications []UserApplication `gorm:"foreignKey:UserID;references:ID"`
}

func (u *User) BeforeUpdate(tx *gorm.DB) error {
	u.UpdatedAt = time.Now()
	return nil
}

func (User) TableName() string {
	return "users"
}

func FindOrCreateUser(ctx context.Context, db *gorm.DB, userId string) (*User, error) {
	user := &User{}
	result := db.Where("user_id = ?", userId).First(&user)

	if result.Error != nil {
		if errors.Is(result.Error, gorm.ErrRecordNotFound) {
			// User doesn't exist, create new user
			newUser := &User{
				UserID: userId,
			}

			if createResult := db.Create(&newUser); createResult.Error != nil {
				db.Config.Logger.Error(ctx, "Failed to create user", "error", createResult.Error)
				return nil, twirp.InternalErrorWith(createResult.Error)
			}

			user = newUser
		} else {
			db.Config.Logger.Error(ctx, "Database query failed", "error", result.Error)
			return nil, twirp.InternalErrorWith(result.Error)
		}
	}

	return user, nil
}

func (u *User) Create(db *gorm.DB) error {
	return db.Create(u).Error
}

func (u *User) Update(db *gorm.DB) error {
	return db.Save(u).Error
}

func (u *User) Delete(db *gorm.DB) error {
	return db.Delete(u).Error
}

func GetUserByID(db *gorm.DB, id string) (*User, error) {
	var user User
	err := db.First(&user, "id = ?", id).Error
	return &user, err
}

func GetUserByUserID(db *gorm.DB, userID string) (*User, error) {
	var user User
	err := db.Where("user_id = ?", userID).First(&user).Error
	return &user, err
}

// GetUsersByPlatform retrieves users by platform
func GetUsersByPlatform(db *gorm.DB, platform string) ([]User, error) {
	var users []User
	err := db.Where("platform = ?", platform).Find(&users).Error
	return users, err
}

func GetUserWithEvents(db *gorm.DB, userID string) (*User, error) {
	var user User
	err := db.Preload("UserEvents").First(&user, "id = ?", userID).Error
	return &user, err
}

func GetUserWithMeta(db *gorm.DB, userID string) (*User, error) {
	var user User
	err := db.Preload("UserMeta").First(&user, "id = ?", userID).Error
	return &user, err
}

func FindOrCreateUserByWoofx3UIUserID(db *gorm.DB, uiUserID string) (*User, error) {
	if uiUserID == "" {
		return nil, errors.New("woofx3UIUserId required")
	}
	var user User
	err := db.Where("woofx3_ui_user_id = ?", uiUserID).First(&user).Error
	if err == nil {
		return &user, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	user = User{Woofx3UIUserID: uiUserID}
	if err := db.Create(&user).Error; err != nil {
		// Unique-violation race: another caller inserted concurrently.
		if reread := db.Where("woofx3_ui_user_id = ?", uiUserID).First(&user).Error; reread == nil {
			return &user, nil
		}
		return nil, err
	}
	return &user, nil
}
