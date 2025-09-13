package messagebus

import (
	"context"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/nats-io/nats.go"
)

// memoryBus implements Bus using in-memory pub/sub
type memoryBus struct {
	mu          sync.RWMutex
	subscribers map[int64]*memorySubscription
	subIDGen    int64
	logger      *slog.Logger
	closed      int32
}

// memorySubscription represents an in-memory subscription
type memorySubscription struct {
	id      int64
	subject string
	handler Handler
	bus     *memoryBus
	pattern *regexp.Regexp
	closed  int32
}

func (s *memorySubscription) Unsubscribe() error {
	if atomic.LoadInt32(&s.closed) == 1 {
		return nil
	}
	atomic.StoreInt32(&s.closed, 1)

	s.bus.mu.Lock()
	delete(s.bus.subscribers, s.id)
	s.bus.mu.Unlock()

	s.bus.logger.Debug("unsubscribed from subject", "subject", s.subject)
	return nil
}

func (s *memorySubscription) Drain() error {
	// For memory backend, drain is equivalent to unsubscribe
	return s.Unsubscribe()
}

func newMemoryBus(ctx context.Context, cfg Config) (Bus, error) {
	logger := cfg.Logger
	if logger == nil {
		logger = slog.Default()
	}

	logger.Info("initialized in-memory message bus")

	return &memoryBus{
		subscribers: make(map[int64]*memorySubscription),
		logger:      logger,
	}, nil
}

func (m *memoryBus) Publish(subject string, data []byte) error {
	if atomic.LoadInt32(&m.closed) == 1 {
		return fmt.Errorf("bus is closed")
	}

	m.mu.RLock()
	subs := make([]*memorySubscription, 0, len(m.subscribers))
	for _, sub := range m.subscribers {
		if atomic.LoadInt32(&sub.closed) == 0 && m.matchesSubject(sub.subject, subject) {
			subs = append(subs, sub)
		}
	}
	m.mu.RUnlock()

	// Deliver messages asynchronously
	for _, sub := range subs {
		go func(sub *memorySubscription) {
			if atomic.LoadInt32(&sub.closed) == 0 {
				msg := &nats.Msg{
					Subject: subject,
					Data:    make([]byte, len(data)),
				}
				copy(msg.Data, data)
				sub.handler(msg)
			}
		}(sub)
	}

	m.logger.Debug("published message", "subject", subject, "subscribers", len(subs))
	return nil
}

func (m *memoryBus) Subscribe(subject string, handler Handler, opts ...SubscribeOption) (Subscription, error) {
	if atomic.LoadInt32(&m.closed) == 1 {
		return nil, fmt.Errorf("bus is closed")
	}

	subID := atomic.AddInt64(&m.subIDGen, 1)
	
	sub := &memorySubscription{
		id:      subID,
		subject: subject,
		handler: handler,
		bus:     m,
	}

	m.mu.Lock()
	m.subscribers[subID] = sub
	m.mu.Unlock()

	m.logger.Debug("subscribed to subject", "subject", subject)

	return sub, nil
}

func (m *memoryBus) Close() {
	if !atomic.CompareAndSwapInt32(&m.closed, 0, 1) {
		return
	}

	m.mu.Lock()
	for _, sub := range m.subscribers {
		atomic.StoreInt32(&sub.closed, 1)
	}
	m.subscribers = make(map[int64]*memorySubscription)
	m.mu.Unlock()

	m.logger.Info("memory bus closed")
}

func (m *memoryBus) AsNATS() (*nats.Conn, bool) {
	return nil, false
}

// matchesSubject checks if a subscription subject pattern matches a publish subject
// Implements NATS wildcard matching:
// - "*" matches exactly one token
// - ">" matches one or more tokens (must be at the end)
func (m *memoryBus) matchesSubject(pattern, subject string) bool {
	patternTokens := strings.Split(pattern, ".")
	subjectTokens := strings.Split(subject, ".")

	return m.matchTokens(patternTokens, subjectTokens)
}

func (m *memoryBus) matchTokens(pattern, subject []string) bool {
	pi, si := 0, 0

	for pi < len(pattern) && si < len(subject) {
		switch pattern[pi] {
		case "*":
			// "*" matches exactly one token
			pi++
			si++
		case ">":
			// ">" matches remaining tokens (must be last in pattern)
			return pi == len(pattern)-1
		default:
			// Exact match required
			if pattern[pi] != subject[si] {
				return false
			}
			pi++
			si++
		}
	}

	// Handle remaining pattern tokens
	if pi < len(pattern) {
		// Only ">" can remain and it must be the last token
		return len(pattern)-pi == 1 && pattern[pi] == ">"
	}

	// Both must be consumed completely
	return pi == len(pattern) && si == len(subject)
}