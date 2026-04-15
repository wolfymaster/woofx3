package main

import (
	"context"
	"log/slog"

	"github.com/casbin/casbin/v2"
	"github.com/casbin/casbin/v2/model"
	"github.com/casbin/casbin/v2/util"
	gormadapter "github.com/casbin/gorm-adapter/v3"
	"github.com/dgraph-io/badger/v3"
	"github.com/google/uuid"
	"github.com/nats-io/nats.go"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/wolfymaster/woofx3/common/runtime"
	"github.com/wolfymaster/woofx3/db/app/types"
	outbox "github.com/wolfymaster/woofx3/db/app/workers"
	"github.com/wolfymaster/woofx3/db/config"
	"github.com/wolfymaster/woofx3/db/database/models"
)

type DatabaseAppConfig struct {
	Logger *slog.Logger
}

type DatabaseApp struct {
	*runtime.BaseApplication
	logger          *slog.Logger
	db              *gorm.DB
	badgerDB        *badger.DB
	casbin          *casbin.Enforcer
	natsConn        *nats.Conn
	eventCache      *outbox.EventCache
	publisherWorker *outbox.PublisherWorker
	ackWorker       *outbox.AckWorker
	cleanupWorker   *outbox.CleanupWorker
	metricsWorker   *outbox.MetricsWorker
	eventPublisher  *outbox.EventPublisher
}

func NewDatabaseApp(cfg *DatabaseAppConfig) *DatabaseApp {
	return &DatabaseApp{
		BaseApplication: runtime.NewBaseApplication(),
		logger:          cfg.Logger,
	}
}

func (a *DatabaseApp) App() *types.App {
	return &types.App{
		BadgerDB:        a.badgerDB,
		Casbin:          a.casbin,
		Db:              a.db,
		Logger:          a.logger,
		NATSConn:        a.natsConn,
		EventCache:      a.eventCache,
		PublisherWorker: a.publisherWorker,
		AckWorker:       a.ackWorker,
		CleanupWorker:   a.cleanupWorker,
		MetricsWorker:   a.metricsWorker,
		EventPublisher:  a.eventPublisher,
	}
}

func (a *DatabaseApp) BadgerDB() *badger.DB {
	return a.badgerDB
}

func (a *DatabaseApp) Casbin() *casbin.Enforcer {
	return a.casbin
}

func (a *DatabaseApp) Db() *gorm.DB {
	return a.db
}

func (a *DatabaseApp) EventCache() *outbox.EventCache {
	return a.eventCache
}

func (a *DatabaseApp) Init(ctx context.Context) error {
	a.logger.Info("Initializing database application")

	services := a.Context().Services

	// Type-safe service access without casting - thanks to generics!
	if postgresSvc, ok := services["postgres"]; ok {
		if typedSvc, ok := postgresSvc.(interface{ Client() *gorm.DB }); ok {
			a.db = typedSvc.Client()
		} else {
			a.logger.Warn("Postgres service does not implement Client() *gorm.DB")
		}
	}

	if badgerSvc, ok := services["badger"]; ok {
		if typedSvc, ok := badgerSvc.(interface{ Client() *badger.DB }); ok {
			a.badgerDB = typedSvc.Client()
		} else {
			a.logger.Warn("Badger service does not implement Client() *badger.DB")
		}
	}

	if natsSvc, ok := services["nats"]; ok {
		if typedSvc, ok := natsSvc.(interface{ Connection() *nats.Conn }); ok {
			a.natsConn = typedSvc.Connection()
		} else {
			a.logger.Warn("NATS service does not implement Connection() *nats.Conn")
		}
	}

	if workerSvc, ok := services["workers"]; ok {
		if typedSvc, ok := workerSvc.(interface {
			EventCache() *outbox.EventCache
			EventPublisher() *outbox.EventPublisher
		}); ok {
			a.eventCache = typedSvc.EventCache()
			a.eventPublisher = typedSvc.EventPublisher()
		} else {
			a.logger.Warn("Workers service does not implement required interface")
		}
	}

	if a.db != nil {
		casbinEnforcer, err := a.initCasbin(a.db)
		if err != nil {
			a.logger.Error("Failed to initialize Casbin", "error", err)
			return err
		}
		a.casbin = casbinEnforcer
		a.logger.Info("Casbin initialized successfully")

		cfg := runtime.GetConfig[*config.DatabaseEnvConfig](a.Context())
		if cfg.ApplicationID != "" {
			if err := a.bootstrapApplication(cfg.ApplicationID, cfg.ApplicationName); err != nil {
				a.logger.Error("Failed to bootstrap application", "error", err, "applicationId", cfg.ApplicationID)
				return err
			}
		}
	}

	return nil
}

func (a *DatabaseApp) bootstrapApplication(applicationID, name string) error {
	appUUID, err := uuid.Parse(applicationID)
	if err != nil {
		return err
	}
	app := models.Application{
		ID:     appUUID,
		Name:   name,
		UserID: uuid.Nil,
	}
	result := a.db.Clauses(clause.OnConflict{DoNothing: true}).Create(&app)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected > 0 {
		a.logger.Info("Bootstrapped application row", "applicationId", applicationID, "name", name)
	}
	return nil
}

func (a *DatabaseApp) Logger() *slog.Logger {
	return a.logger
}

func (a *DatabaseApp) NATSConn() *nats.Conn {
	return a.natsConn
}

func (a *DatabaseApp) Run(ctx context.Context) error {
	a.logger.Info("Running database application")

	<-ctx.Done()
	return nil
}

func (a *DatabaseApp) Terminate(ctx context.Context) error {
	a.logger.Info("Terminating database application")

	return nil
}

func (a *DatabaseApp) initCasbin(db *gorm.DB) (*casbin.Enforcer, error) {
	adapter, err := gormadapter.NewAdapterByDBUseTableName(db, "", "permissions")
	if err != nil {
		return nil, err
	}

	modelString, err := config.GetCasbinModelString()
	if err != nil {
		return nil, err
	}

	modelObj, err := model.NewModelFromString(modelString)
	if err != nil {
		return nil, err
	}

	enforcer, err := casbin.NewEnforcer(modelObj, adapter)
	if err != nil {
		return nil, err
	}

	a.setupCustomEnforcerFunctions(enforcer)

	return enforcer, nil
}

func (a *DatabaseApp) setupCustomEnforcerFunctions(enforcer *casbin.Enforcer) {
	enforcer.AddFunction("hasRole", func(args ...any) (any, error) {
		if len(args) != 3 {
			return false, nil
		}

		reqSub := args[0].(string)
		reqObj := args[1].(string)
		reqRole := args[2].(string)

		roles, err := enforcer.GetGroupingPolicy()
		if err != nil {
			return false, err
		}

		for _, role := range roles {
			if len(role) >= 3 {
				policyUser := role[0]
				policyObj := role[1]
				policyRole := role[2]

				if util.KeyMatch2(reqSub, policyUser) &&
					util.KeyMatch2(reqObj, policyObj) &&
					reqRole == policyRole {
					return true, nil
				}
			}
		}
		return false, nil
	})

	enforcer.AddFunction("hasObjType", func(args ...any) (any, error) {
		if len(args) != 2 {
			return false, nil
		}

		reqObj := args[0].(string)
		reqObjType := args[1].(string)

		objTypes, err := enforcer.GetNamedGroupingPolicy("g2")
		if err != nil {
			return false, err
		}

		for _, objType := range objTypes {
			if len(objType) >= 2 {
				policyObj := objType[0]
				policyObjType := objType[1]

				if util.KeyMatch2(reqObj, policyObj) && reqObjType == policyObjType {
					return true, nil
				}
			}
		}
		return false, nil
	})
}
