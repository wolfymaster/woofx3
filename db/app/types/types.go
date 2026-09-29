package types

import (
	"context"
	"database/sql"
	"log/slog"

	"github.com/casbin/casbin/v2"
	"github.com/nats-io/nats.go"
	"gorm.io/gorm"

	"github.com/wolfymaster/woofx3/db/app/secrets"
	outbox "github.com/wolfymaster/woofx3/db/app/workers"
)

type IsPermissionable interface {
	HasPermission(ctx context.Context, enforcer *casbin.Enforcer, method string, request any) (bool, error)
}

type App struct {
	ModuleStorage   *sql.DB
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
	Secrets         *secrets.Box
}
