package main

import (
	"context"
	"log/slog"
	"os"

	"github.com/casbin/casbin/v2"
	"github.com/casbin/casbin/v2/model"
	"github.com/casbin/casbin/v2/util"

	gormadapter "github.com/casbin/gorm-adapter/v3"
	"gorm.io/gorm"

	"github.com/dgraph-io/badger/v3"
	"github.com/wolfymaster/woofx3/db/internal/config"
	database "github.com/wolfymaster/woofx3/db/internal/database"
	"github.com/wolfymaster/woofx3/db/internal/types"
)

func Bootstrap(ctx context.Context) *types.App {
	// setup logger
	logger := initLogger()
	slog.SetDefault(logger)

	// Initialize main postgres database
	db, err := initPostgres(logger)
	if err != nil {
		slog.ErrorContext(ctx, "Failed to initialize database", "error", err)
	}
	slog.Info("Connected to the database!")

	// Initialize Badger k/v database
	badgerDB, err := initBadger()
	if err != nil {
		slog.ErrorContext(ctx, "Failed to initialize badger db", "error", err)
	}
	slog.Info("Connected to the badger db!")

	// Initialize Casbin
	casbin, err := initCasbin(db)
	if err != nil {
		slog.ErrorContext(ctx, "Failed to initialize casbin", "error", err)
	}
	slog.Info("Connected to the casbin db!")

	return &types.App{
		BadgerDB: badgerDB,
		Casbin:   casbin,
		Db:       db,
		Logger:   logger,
	}
}

func initLogger() *slog.Logger {
	return slog.New(slog.NewJSONHandler(os.Stdout, nil))
}

func initPostgres(logger *slog.Logger) (*gorm.DB, error) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		slog.Error("DATABASE_URL is not set")
		os.Exit(1)
	}

	return database.InitializeDB(dsn, logger)
}

func initBadger() (*badger.DB, error) {
	return database.InitializeBadgerDB("../badger")
}

func initCasbin(db *gorm.DB) (*casbin.Enforcer, error) {
	adapter, err := gormadapter.NewAdapterByDBUseTableName(db, "", "permissions")
	if err != nil {
		return nil, err
	}

	modelString, err := config.GetCasbinModelString()
	if err != nil {
		return nil, err
	}

	model, err := model.NewModelFromString(modelString)
	if err != nil {
		return nil, err
	}

	enforcer, err := casbin.NewEnforcer(model, adapter)
	if err != nil {
		return nil, err
	}

	setupCustomEnforcerFunctions(enforcer)

	return enforcer, nil
}

func setupCustomEnforcerFunctions(enforcer *casbin.Enforcer) {
	// has role
	enforcer.AddFunction("hasRole", func(args ...any) (any, error) {
		if len(args) != 3 {
			return false, nil
		}

		reqSub := args[0].(string)
		reqObj := args[1].(string)
		reqRole := args[2].(string)

		// Get all role assignments
		roles, err := enforcer.GetGroupingPolicy()
		if err != nil {

		}

		for _, role := range roles {
			if len(role) >= 3 {
				policyUser := role[0]
				policyObj := role[1]
				policyRole := role[2]

				// Check if patterns match
				if util.KeyMatch2(reqSub, policyUser) &&
					util.KeyMatch2(reqObj, policyObj) &&
					reqRole == policyRole {
					return true, nil
				}
			}
		}
		return false, nil
	})

	// has object type
	enforcer.AddFunction("hasObjType", func(args ...any) (any, error) {
		if len(args) != 2 {
			return false, nil
		}

		reqObj := args[0].(string)
		reqObjType := args[1].(string)

		// Get all object type assignments
		objTypes, err := enforcer.GetNamedGroupingPolicy("g2")
		if err != nil {

		}

		for _, objType := range objTypes {
			if len(objType) >= 2 {
				policyObj := objType[0]
				policyObjType := objType[1]

				// Check if patterns match
				if util.KeyMatch2(reqObj, policyObj) && reqObjType == policyObjType {
					return true, nil
				}
			}
		}
		return false, nil
	})
}
