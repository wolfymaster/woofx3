package types

import (
	"context"
	"log/slog"

	"github.com/casbin/casbin/v2"
	"github.com/dgraph-io/badger/v3"
	"gorm.io/gorm"
)

type IsPermissionable interface {
	HasPermission(ctx context.Context, enforcer *casbin.Enforcer, method string, request any) (bool, error)
}

type App struct {
	BadgerDB *badger.DB
	Casbin   *casbin.Enforcer
	Db       *gorm.DB
	Logger   *slog.Logger
}
