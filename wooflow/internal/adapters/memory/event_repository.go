package memory

import (
	"context"
	"fmt"
	"sync"

	"github.com/wolfymaster/woofx3/workflow/internal/core"
	"github.com/wolfymaster/woofx3/workflow/internal/ports"
)

// EventRepository implements ports.EventRepository using in-memory storage
type EventRepository struct {
	mu     sync.RWMutex
	events map[string]*core.Event
}

// NewEventRepository creates a new memory event repository
func NewEventRepository() ports.EventRepository {
	return &EventRepository{
		events: make(map[string]*core.Event),
	}
}

// StoreEvent stores an event in memory
func (r *EventRepository) StoreEvent(ctx context.Context, event *core.Event) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.events[event.ID] = event
	return nil
}

// GetEvent retrieves an event by ID
func (r *EventRepository) GetEvent(ctx context.Context, id string) (*core.Event, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	event, exists := r.events[id]
	if !exists {
		return nil, fmt.Errorf("event not found: %s", id)
	}

	return event, nil
}

// QueryEvents queries events based on filter criteria
func (r *EventRepository) QueryEvents(ctx context.Context, filter *core.EventFilter) ([]*core.Event, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var events []*core.Event
	for _, event := range r.events {
		if filter != nil {
			if filter.Type != "" && event.Type != filter.Type {
				continue
			}
		}
		events = append(events, event)
	}

	return events, nil
}
