package main

import (
	"context"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"
)

var Db *pgxpool.Pool

// InitializeDB initializes the database connection pool.
func InitializeDB(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
	var err error
	Db, err = pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, err
	}

	// Test the connection
	err = Db.Ping(ctx)
	if err != nil {
		return nil, err
	}

	slog.Info("Connected to the database!")
	return Db, nil
}
