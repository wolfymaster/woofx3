package services

import (
	"context"
	"log/slog"

	"github.com/wolfymaster/woofx3/common/runtime"
	"github.com/wolfymaster/woofx3/db/database"
	"gorm.io/gorm"
)

// DatabaseService owns the system GORM connection (Postgres or SQLite,
// selected from WOOFX3_DATABASE_URL / databaseUrl scheme).
type DatabaseService struct {
	*runtime.BaseService[*gorm.DB]
	databaseURL string
	logger      *slog.Logger
	ids         database.IDSource
	db          *gorm.DB
}

func NewDatabaseService(databaseURL string, logger *slog.Logger, ids database.IDSource) *DatabaseService {
	return &DatabaseService{
		BaseService: runtime.NewBaseService[*gorm.DB]("database", "database", nil, false),
		databaseURL: databaseURL,
		logger:      logger,
		ids:         ids,
	}
}

func (s *DatabaseService) Connect(ctx context.Context, appCtx *runtime.ApplicationContext) error {
	parsed, err := database.ParseDatabaseURL(s.databaseURL)
	if err != nil {
		return err
	}
	s.logger.Info("Connecting to system database", "dialect", parsed.Dialect, "url", s.databaseURL)

	db, err := database.InitializeDB(s.databaseURL, s.logger, s.ids)
	if err != nil {
		return err
	}

	s.db = db
	s.SetClient(db)

	return s.BaseService.Connect(ctx, appCtx)
}

func (s *DatabaseService) Disconnect(ctx context.Context) error {
	s.logger.Info("Disconnecting from system database")

	if s.db != nil {
		if sqlDB, err := s.db.DB(); err == nil {
			sqlDB.Close()
		}
	}

	return s.BaseService.Disconnect(ctx)
}
