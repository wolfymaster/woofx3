package domain

import (
	"context"
	"fmt"
	"sync"

	"github.com/wolfymaster/woofx3/workflow/internal/core"
)

// MemoryEventRepository implements the EventRepository interface using in-memory storage
type MemoryEventRepository struct {
	events map[string]*core.Event
	mu     sync.RWMutex
}

// GetEvent implements ports.EventRepository.
func (r *MemoryEventRepository) GetEvent(ctx context.Context, id string) (*core.Event, error) {
	panic("unimplemented")
}

// NewMemoryEventRepository creates a new in-memory event repository
func NewMemoryEventRepository() *MemoryEventRepository {
	return &MemoryEventRepository{
		events: make(map[string]*core.Event),
	}
}

// StoreEvent stores an event in memory
func (r *MemoryEventRepository) StoreEvent(ctx context.Context, event *core.Event) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.events[event.ID] = event
	return nil
}

// GetEventByID retrieves an event by ID
func (r *MemoryEventRepository) GetEventByID(ctx context.Context, id string) (*core.Event, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	event, ok := r.events[id]
	if !ok {
		return nil, fmt.Errorf("event not found: %s", id)
	}

	return event, nil
}

// QueryEvents queries events based on filter
func (r *MemoryEventRepository) QueryEvents(ctx context.Context, filter *core.EventFilter) ([]*core.Event, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var events []*core.Event
	for _, event := range r.events {
		if filter.Type == "" || event.Type == filter.Type {
			events = append(events, event)
		}
	}

	return events, nil
}
