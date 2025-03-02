package services

import (
	"context"
	"errors"

	"github.com/twitchtv/twirp"
	models "github.com/wolfymaster/wolfyttv-db/models"
	rpc "github.com/wolfymaster/wolfyttv/buf"
	"gorm.io/gorm"
)

type UserService struct {
	db *gorm.DB
}

func NewUserService(db *gorm.DB) *UserService {
	return &UserService{
		db: db,
	}
}

// func (u *UserService) CreateEvent(ctx context.Context, userId int32, eventType string, eventValue string) error {
// 	query := `INSERT into userevents (userid, eventtype, eventvalue) VALUES($1, $2, $3)`
// 	_, err := u.db.Exec(ctx, query, userId, eventType, eventValue)
// 	return err
// }

// func (u *UserService) CreateMessage(ctx context.Context, userId string, message string) error {
// 	query := `INSERT into usermessages (userid, message) VALUES($1)`
// 	_, err := u.db.Exec(ctx, query, userId, message)
// 	return err
// }

// GetToken queries the database for a user's token by username.
func (u *UserService) GetUserToken(ctx context.Context, req *rpc.GetUserTokenRequest) (*rpc.GetUserTokenResponse, error) {
	user := &models.User{}
	result := u.db.Table("users").Where("user_id = ?", req.UserId).Select("token").First(&user)

	if result.Error != nil {
		if errors.Is(result.Error, gorm.ErrRecordNotFound) {
			u.db.Config.Logger.Info(ctx, "User not found", "userId", req.UserId)
			return nil, twirp.NotFoundError("user not found")
		}

		u.db.Config.Logger.Error(ctx, "Database query failed", "error", result.Error)
		return nil, result.Error
	}

	return &rpc.GetUserTokenResponse{
		Token: user.Token,
	}, nil
}

// GetToken queries the database for a user's token by username.
func (u *UserService) GetBroadcasterToken(ctx context.Context, req *rpc.GetBroadcasterTokenRequest) (*rpc.GetBroadcasterTokenResponse, error) {
	setting := &models.Setting{}
	result := u.db.Table("settings").
		Where("setting_name = ? AND broadcaster_id = ?", "twitch_token", req.BroadcasterId).
		Select("setting_value").
		First(&setting)

	if result.Error != nil {
		if errors.Is(result.Error, gorm.ErrRecordNotFound) {
			u.db.Config.Logger.Info(ctx, "Setting not found",
				"settingName", "twitch_token",
				"broadcasterId", req.BroadcasterId)
			return nil, twirp.NotFoundError("broadcaster token not found")
		}

		u.db.Config.Logger.Error(ctx, "Database query failed",
			"error", result.Error,
			"broadcasterId", req.BroadcasterId)
		return nil, result.Error
	}

	return &rpc.GetBroadcasterTokenResponse{
		Token: setting.SettingValue,
	}, nil
}
