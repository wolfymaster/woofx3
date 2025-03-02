package main

import (
	"log/slog"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"gorm.io/gorm/schema"
)

func InitializeDB(dsn string, slogger *slog.Logger) (*gorm.DB, error) {
	// slog logger
	slogAdapter := NewSlogAdapter(slogger, logger.Config{
		SlowThreshold:             200 * time.Millisecond,
		LogLevel:                  logger.Info,
		IgnoreRecordNotFoundError: true,
		Colorful:                  false,
	})

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: slogAdapter,
		NamingStrategy: schema.NamingStrategy{
			SingularTable: true,
		},
	})

	if err != nil {
		return nil, err
	}

	// Get underlying SQL DB to set connection pool parameters
	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}

	// Set connection pool settings
	sqlDB.SetMaxIdleConns(10)
	sqlDB.SetMaxOpenConns(100)
	sqlDB.SetConnMaxLifetime(time.Hour)

	// Enable UUID extension if it's not already enabled
	db.Exec("CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\"")

	// TODO: Enable
	// db.AutoMigrate(&User{}, &Setting{}, &UserEvent{}, &UserMessage{})

	return db, nil
}
