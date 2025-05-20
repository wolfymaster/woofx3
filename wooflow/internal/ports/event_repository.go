package ports

import (
	"context"

	"github.com/wolfymaster/woofx3/workflow/internal/core"
)

// EventRepository defines the interface for event storage
type EventRepository interface {
	StoreEvent(ctx context.Context, event *core.Event) error
	GetEvent(ctx context.Context, id string) (*core.Event, error)
	QueryEvents(ctx context.Context, filter *core.EventFilter) ([]*core.Event, error)
}
