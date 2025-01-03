package coredb

import (
	"context"
	"log"

	"github.com/jackc/pgx/v5/pgxpool"
)

var db *pgxpool.Pool

// InitializeDB initializes the database connection pool.
func InitializeDB(ctx context.Context, dsn string) error {
	var err error
	db, err = pgxpool.New(ctx, dsn)
	if err != nil {
		return err
	}

	// Test the connection
	err = db.Ping(ctx)
	if err != nil {
		return err
	}

	log.Println("Connected to the database!")
	return nil
}

// GetToken queries the database for a user's token by username.
func GetToken(ctx context.Context, username string) (string, error) {
	var token string
	query := `SELECT token FROM users WHERE username = $1`
	err := db.QueryRow(ctx, query, username).Scan(&token)
	if err != nil {
		return "", err
	}
	return token, nil
}
