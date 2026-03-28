package workers

import (
	"sync"
	"time"

	"github.com/wolfymaster/woofx3/db/database/models"
)

type CachedEvent struct {
	Event     *models.WorkerEvent
	ExpiresAt time.Time
	Attempts  int
	RetryTTL  time.Duration
}

func (ce *CachedEvent) IsExpired() bool {
	return time.Now().After(ce.ExpiresAt)
}

func (ce *CachedEvent) CanRetry() bool {
	return ce.Attempts < ce.Event.MaxAttempts
}

func (ce *CachedEvent) ResetTTL() {
	ce.ExpiresAt = time.Now().Add(ce.RetryTTL)
	ce.Attempts++
}

type EventCache struct {
	mu     sync.RWMutex
	events map[string]*CachedEvent
}

func NewEventCache() *EventCache {
	return &EventCache{
		events: make(map[string]*CachedEvent),
	}
}

func (ec *EventCache) Add(event *models.WorkerEvent, ttl time.Duration) {
	ec.mu.Lock()
	defer ec.mu.Unlock()

	ec.events[event.ID] = &CachedEvent{
		Event:     event,
		ExpiresAt: time.Now().Add(ttl),
		Attempts:  1,
		RetryTTL:  ttl,
	}
}

func (ec *EventCache) Remove(eventID string) {
	ec.mu.Lock()
	defer ec.mu.Unlock()

	delete(ec.events, eventID)
}

func (ec *EventCache) Get(eventID string) (*CachedEvent, bool) {
	ec.mu.RLock()
	defer ec.mu.RUnlock()

	cached, exists := ec.events[eventID]
	return cached, exists
}

func (ec *EventCache) GetExpired() []*CachedEvent {
	ec.mu.RLock()
	defer ec.mu.RUnlock()

	var expired []*CachedEvent
	now := time.Now()

	for _, cached := range ec.events {
		if now.After(cached.ExpiresAt) && cached.CanRetry() {
			expired = append(expired, cached)
		}
	}

	return expired
}

func (ec *EventCache) GetMaxRetriesExceeded() []*CachedEvent {
	ec.mu.RLock()
	defer ec.mu.RUnlock()

	var exceeded []*CachedEvent

	for _, cached := range ec.events {
		if !cached.CanRetry() && cached.IsExpired() {
			exceeded = append(exceeded, cached)
		}
	}

	return exceeded
}

func (ec *EventCache) Size() int {
	ec.mu.RLock()
	defer ec.mu.RUnlock()

	return len(ec.events)
}

func (ec *EventCache) UpdateAttempts(eventID string) {
	ec.mu.Lock()
	defer ec.mu.Unlock()

	if cached, exists := ec.events[eventID]; exists {
		cached.ResetTTL()
	}
}

func (ec *EventCache) GetStats() CacheStats {
	ec.mu.RLock()
	defer ec.mu.RUnlock()

	stats := CacheStats{
		TotalEvents: len(ec.events),
	}

	now := time.Now()
	for _, cached := range ec.events {
		if now.After(cached.ExpiresAt) {
			stats.ExpiredEvents++
		}
		if cached.Attempts > 1 {
			stats.RetryingEvents++
		}
	}

	return stats
}

type CacheStats struct {
	TotalEvents    int
	ExpiredEvents  int
	RetryingEvents int
}
