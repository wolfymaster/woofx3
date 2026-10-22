package types

import (
	"context"
	"database/sql"
	"log/slog"
	"time"

	"github.com/casbin/casbin/v2"
	"github.com/nats-io/nats.go"
	"gorm.io/gorm"

	"github.com/wolfymaster/woofx3/db/app/secrets"
	outbox "github.com/wolfymaster/woofx3/db/app/workers"
	"github.com/wolfymaster/woofx3/db/database"
)

type IsPermissionable interface {
	HasPermission(ctx context.Context, enforcer *casbin.Enforcer, method string, request any) (bool, error)
}

type App struct {
	ModuleStorage *sql.DB
	Casbin        *casbin.Enforcer
	Db            *gorm.DB
	IDs           database.IDSource
	Now           func() time.Time
	Logger        *slog.Logger
	// Workers is the worker configuration main loaded once at startup, for
	// the workers and for the routes that report on what they keep.
	Workers         outbox.Config
	NATSConn        *nats.Conn
	EventCache      *outbox.EventCache
	PublisherWorker *outbox.PublisherWorker
	AckWorker       *outbox.AckWorker
	CleanupWorker   *outbox.CleanupWorker
	MetricsWorker   *outbox.MetricsWorker
	EventPublisher  *outbox.EventPublisher
	Secrets         *secrets.Box
	SettingSeal     *secrets.SettingSeal
}
