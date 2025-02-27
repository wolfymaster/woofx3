package user

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/wolfymaster/wolfyttv-db/services/types"
)

type UserService struct {
	db *pgxpool.Pool
}

func NewUserService(db *pgxpool.Pool) *UserService {
	return &UserService{
		db: db,
	}
}

func (u *UserService) CreateEvent(ctx context.Context, userId int32, eventType string, eventValue string) error {
	query := `INSERT into userevents (userid, eventtype, eventvalue) VALUES($1, $2, $3)`
	_, err := u.db.Exec(ctx, query, userId, eventType, eventValue)
	return err
}

func (u *UserService) CreateMessage(ctx context.Context, userId string, message string) error {
	query := `INSERT into usermessages (userid, message) VALUES($1)`
	_, err := u.db.Exec(ctx, query, userId, message)
	return err
}

// GetToken queries the database for a user's token by username.
func (u *UserService) GetToken(ctx context.Context, userId string) (string, error) {
	var token string
	query := `SELECT token FROM users WHERE user_id = $1`
	err := u.db.QueryRow(ctx, query, userId).Scan(&token)
	if err != nil {
		return "", err
	}
	return token, nil
}

// GetToken queries the database for a user's token by username.
func (u *UserService) GetBroadcasterToken(ctx context.Context, broadcasterId string) (string, error) {
	var token string
	query := `SELECT setting_value FROM settings WHERE setting_name = $1 AND broadcaster_id = $2`
	err := u.db.QueryRow(ctx, query, "twitch_token", broadcasterId).Scan(&token)
	if err != nil {
		return "", err
	}
	return token, nil
}

func (u *UserService) FindOrCreateUser(ctx context.Context, userId string) (*types.TwitchUser, error) {
	var user types.TwitchUser

	findQuery := `SELECT id, username, user_id FROM users WHERE user_id = $1`
	err := u.db.QueryRow(ctx, findQuery, userId).Scan(&user.Id, &user.Username, &user.UserId)

	if err == nil {
		return &user, nil
	}

	createQuery := `
		INSERT INTO users (user_id) 
		VALUES ($1) 
		RETURNING id, user_id
	`

	err = u.db.QueryRow(ctx, createQuery, userId).Scan(&user.Id, &user.UserId)
	if err != nil {
		return nil, err
	}

	return &user, nil
}
