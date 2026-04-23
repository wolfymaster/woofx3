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

// Logger is the minimal surface EventTriggerRegistrar needs for recording
// non-fatal errors (e.g. failed Unsubscribe during an update). A nil logger
// is a no-op.
type Logger interface {
	Error(msg string, keysAndValues ...any)
}

// EventTriggerRegistrar maintains one NATS subscription per distinct event subject,
// ref-counted by the set of workflow IDs that reference it. Safe for concurrent use.
type EventTriggerRegistrar struct {
	mu        sync.Mutex
	sub       Subscriber
	onEvent   EventHandler
	logger    Logger
	subjects  map[string]*subjectEntry // subject -> entry
	workflows map[string]string        // workflowID -> last-registered subject
}

type subjectEntry struct {
	sub          Subscription
	refWorkflows map[string]struct{}
}

// NewEventTriggerRegistrar constructs the registrar. `onEvent` is invoked for every
// message received on any subscribed subject; it should forward into the engine's
// event-handling path (see `workflow/app.go:handleTriggerEvent`). `logger` may be
// nil; when non-nil it records non-fatal errors encountered during bookkeeping
// (e.g. failed Unsubscribe during an update).
func NewEventTriggerRegistrar(sub Subscriber, onEvent EventHandler, logger Logger) *EventTriggerRegistrar {
	return &EventTriggerRegistrar{
		sub:       sub,
		onEvent:   onEvent,
		logger:    logger,
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
	// workflow case), release the old subject first. A failure to unsubscribe the
	// old subject must not abort the move; the caller's intent is to switch to the
	// new subject, so we log and press on to keep the workflow registered somewhere.
	if prev, ok := r.workflows[workflowID]; ok {
		if prev == trigger.EventType {
			return nil
		}
		if err := r.releaseLocked(workflowID, prev); err != nil && r.logger != nil {
			r.logger.Error("triggers: release prior subject failed; continuing with new registration",
				"workflow_id", workflowID,
				"prev_subject", prev,
				"error", err)
		}
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
		// Drop in-memory state first so a failed Unsubscribe can't leave a dead
		// entry that later Registers would reuse, silently skipping Subscribe.
		delete(r.subjects, subject)
		if err := entry.sub.Unsubscribe(); err != nil {
			return fmt.Errorf("unsubscribe from %s: %w", subject, err)
		}
	}
	return nil
}
