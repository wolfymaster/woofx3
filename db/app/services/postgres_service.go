package services

import (
	"context"
	"log/slog"

	"github.com/wolfymaster/woofx3/common/runtime"
	"github.com/wolfymaster/woofx3/db/database"
	"gorm.io/gorm"
)

type PostgresService struct {
	*runtime.BaseService[*gorm.DB]
	databaseURL string
	logger      *slog.Logger
	db          *gorm.DB
}

func NewPostgresService(databaseURL string, logger *slog.Logger) *PostgresService {
	return &PostgresService{
		BaseService: runtime.NewBaseService[*gorm.DB]("postgres", "database", nil, false), // Local DB doesn't need external heartbeat monitoring
		databaseURL: databaseURL,
		logger:      logger,
	}
}

func (s *PostgresService) Connect(ctx context.Context, appCtx *runtime.ApplicationContext) error {
	s.logger.Info("Connecting to postgres database", "url", s.databaseURL)

	db, err := database.InitializeDB(s.databaseURL, s.logger)
	if err != nil {
		return err
	}

	s.db = db
	s.SetClient(db)

	return s.BaseService.Connect(ctx, appCtx)
}

func (s *PostgresService) Disconnect(ctx context.Context) error {
	s.logger.Info("Disconnecting from postgres database")

	if s.db != nil {
		if sqlDB, err := s.db.DB(); err == nil {
			sqlDB.Close()
		}
	}

	return s.BaseService.Disconnect(ctx)
}
