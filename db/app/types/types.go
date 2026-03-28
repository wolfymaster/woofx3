package types

import (
	"context"
	"log/slog"

	"github.com/casbin/casbin/v2"
	"github.com/dgraph-io/badger/v3"
	"github.com/nats-io/nats.go"
	"gorm.io/gorm"

	outbox "github.com/wolfymaster/woofx3/db/app/workers"
)

type IsPermissionable interface {
	HasPermission(ctx context.Context, enforcer *casbin.Enforcer, method string, request any) (bool, error)
}

type App struct {
	BadgerDB        *badger.DB
	Casbin          *casbin.Enforcer
	Db              *gorm.DB
	Logger          *slog.Logger
	NATSConn        *nats.Conn
	EventCache      *outbox.EventCache
	PublisherWorker *outbox.PublisherWorker
	AckWorker       *outbox.AckWorker
	CleanupWorker   *outbox.CleanupWorker
	MetricsWorker   *outbox.MetricsWorker
	EventPublisher  *outbox.EventPublisher
}
