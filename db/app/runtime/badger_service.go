package services

import (
	"context"
	"log/slog"

	"github.com/dgraph-io/badger/v3"
	"github.com/wolfymaster/woofx3/common/runtime"
	"github.com/wolfymaster/woofx3/db/database"
)

type BadgerService struct {
	*runtime.BaseService[*badger.DB]
	badgerPath string
	logger     *slog.Logger
	db         *badger.DB
}

func NewBadgerService(badgerPath string, logger *slog.Logger) *BadgerService {
	return &BadgerService{
		BaseService: runtime.NewBaseService[*badger.DB]("badger", "database", nil, false), // Local DB doesn't need external heartbeat monitoring
		badgerPath:  badgerPath,
		logger:      logger,
	}
}

func (s *BadgerService) Connect(ctx context.Context, appCtx *runtime.ApplicationContext) error {
	s.logger.Info("Connecting to badger database", "path", s.badgerPath)

	db, err := database.InitializeBadgerDB(s.badgerPath)
	if err != nil {
		return err
	}

	s.db = db
	s.SetClient(db)

	return s.BaseService.Connect(ctx, appCtx)
}

func (s *BadgerService) Disconnect(ctx context.Context) error {
	s.logger.Info("Disconnecting from badger database")

	if s.db != nil {
		s.db.Close()
	}

	return s.BaseService.Disconnect(ctx)
}
