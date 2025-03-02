package models

import (
	"context"
	"errors"
	"time"

	"github.com/twitchtv/twirp"
	"gorm.io/gorm"
)

type User struct {
	ID        int       `gorm:"primaryKey;autoIncrement"`
	Username  string    `gorm:"type:varchar(50);not null"`
	UserID    string    `gorm:"column:user_id;not null"`
	CreatedAt time.Time `gorm:"default:CURRENT_TIMESTAMP;not null"`
	UpdatedAt time.Time `gorm:"default:CURRENT_TIMESTAMP;not null"`
	Token     string    `gorm:"type:text"`

	// Relationships
	UserEvents   []UserEvent   `gorm:"foreignKey:UserID;references:UserID"`
	UserMessages []UserMessage `gorm:"foreignKey:UserID;references:UserID"`
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
