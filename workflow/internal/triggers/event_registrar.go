package triggers

import (
	"fmt"
	"sync"

	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// Subscription is the minimal surface we need from a NATS subscription handle.
type Subscription interface {
	Unsubscribe() error
}

// Subscriber is the minimal surface we need from the NATS client: given a subject
// and a handler (raw payload + concrete subject), return an unsubscribable handle.
// This keeps us decoupled from the natsclient package for testing.
type Subscriber interface {
	Subscribe(subject string, handler func(payload []byte, subject string)) (Subscription, error)
}

// EventHandler is what the registrar calls when a subscribed subject fires.
// It is the bridge into the engine (typically `app.handleTriggerEvent`).
type EventHandler func(payload []byte, subject string)

// EventTriggerRegistrar maintains one NATS subscription per distinct event subject,
// ref-counted by the set of workflow IDs that reference it. Safe for concurrent use.
type EventTriggerRegistrar struct {
	mu        sync.Mutex
	sub       Subscriber
	onEvent   EventHandler
	subjects  map[string]*subjectEntry // subject -> entry
	workflows map[string]string        // workflowID -> last-registered subject
}

type subjectEntry struct {
	sub          Subscription
	refWorkflows map[string]struct{}
}

// NewEventTriggerRegistrar constructs the registrar. `onEvent` is invoked for every
// message received on any subscribed subject; it should forward into the engine's
// event-handling path (see `workflow/app.go:handleTriggerEvent`).
func NewEventTriggerRegistrar(sub Subscriber, onEvent EventHandler) *EventTriggerRegistrar {
	return &EventTriggerRegistrar{
		sub:       sub,
		onEvent:   onEvent,
		subjects:  make(map[string]*subjectEntry),
		workflows: make(map[string]string),
	}
}

func (r *EventTriggerRegistrar) Register(workflowID string, trigger *types.TriggerConfig) error {
	if trigger == nil || trigger.Type != "event" || trigger.EventType == "" {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()

	// If this workflow was previously registered under a different subject (updated
	// workflow case), release the old subject first.
	if prev, ok := r.workflows[workflowID]; ok {
		if prev == trigger.EventType {
			return nil
		}
		r.releaseLocked(workflowID, prev)
	}

	entry, ok := r.subjects[trigger.EventType]
	if !ok {
		sub, err := r.sub.Subscribe(trigger.EventType, func(payload []byte, subject string) {
			if r.onEvent != nil {
				r.onEvent(payload, subject)
			}
		})
		if err != nil {
			return fmt.Errorf("subscribe to %s: %w", trigger.EventType, err)
		}
		entry = &subjectEntry{sub: sub, refWorkflows: make(map[string]struct{})}
		r.subjects[trigger.EventType] = entry
	}
	entry.refWorkflows[workflowID] = struct{}{}
	r.workflows[workflowID] = trigger.EventType
	return nil
}

func (r *EventTriggerRegistrar) Unregister(workflowID string, trigger *types.TriggerConfig) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	subject, ok := r.workflows[workflowID]
	if !ok {
		return nil
	}
	return r.releaseLocked(workflowID, subject)
}

// releaseLocked must be called with r.mu held.
func (r *EventTriggerRegistrar) releaseLocked(workflowID, subject string) error {
	entry, ok := r.subjects[subject]
	if !ok {
		delete(r.workflows, workflowID)
		return nil
	}
	delete(entry.refWorkflows, workflowID)
	delete(r.workflows, workflowID)
	if len(entry.refWorkflows) == 0 {
		if err := entry.sub.Unsubscribe(); err != nil {
			return fmt.Errorf("unsubscribe from %s: %w", subject, err)
		}
		delete(r.subjects, subject)
	}
	return nil
}
