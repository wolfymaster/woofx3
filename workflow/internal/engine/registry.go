package engine

import (
	"fmt"
	"sync"

	"github.com/wolfymaster/woofx3/workflow/internal/eventmatch"
	"github.com/wolfymaster/woofx3/workflow/internal/triggers"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

type WorkflowRegistry struct {
	mu        sync.RWMutex
	workflows map[string]*types.WorkflowDefinition
	registrar triggers.Registrar
	logger    logger
}

// logger is the minimal interface the registry needs; engine.Engine passes its own.
type logger interface {
	Error(msg string, keysAndValues ...any)
}

func NewWorkflowRegistry() *WorkflowRegistry {
	return &WorkflowRegistry{
		workflows: make(map[string]*types.WorkflowDefinition),
		registrar: triggers.NoopRegistrar{},
	}
}

// SetRegistrar wires a trigger registrar. Must be called before any Register/Remove.
// Passing nil restores the noop registrar.
func (r *WorkflowRegistry) SetRegistrar(reg triggers.Registrar) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if reg == nil {
		r.registrar = triggers.NoopRegistrar{}
		return
	}
	r.registrar = reg
}

// SetLogger wires a logger for recording registrar errors. Errors are non-fatal:
// a failed subscribe should not unregister the workflow.
func (r *WorkflowRegistry) SetLogger(l logger) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.logger = l
}

func (r *WorkflowRegistry) Register(def *types.WorkflowDefinition) error {
	if def.ID == "" {
		return fmt.Errorf("workflow ID is required")
	}
	if def.Name == "" {
		return fmt.Errorf("workflow name is required")
	}
	if len(def.Tasks) == 0 {
		return fmt.Errorf("workflow must have at least one task")
	}

	r.mu.Lock()
	prev, existed := r.workflows[def.ID]
	r.workflows[def.ID] = def
	registrar := r.registrar
	logger := r.logger
	r.mu.Unlock()

	// On update, release any prior trigger first, then register the new one.
	// Call the registrar without holding r.mu to avoid lock ordering issues
	// between this mutex and the registrar's internal mutex.
	if existed && prev.Trigger != nil {
		if err := registrar.Unregister(def.ID, prev.Trigger); err != nil && logger != nil {
			logger.Error("triggers: unregister failed during update", "workflow_id", def.ID, "error", err)
		}
	}
	if def.Trigger != nil {
		if err := registrar.Register(def.ID, def.Trigger); err != nil && logger != nil {
			logger.Error("triggers: register failed", "workflow_id", def.ID, "error", err)
		}
	}
	return nil
}

func (r *WorkflowRegistry) Get(id string) (*types.WorkflowDefinition, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	wf, ok := r.workflows[id]
	if !ok {
		return nil, fmt.Errorf("workflow not found: %s", id)
	}
	return wf, nil
}

// GetByEventType returns workflows whose trigger event-type matches the given
// concrete event subject. The trigger's EventType may be an exact subject or a
// NATS-style pattern (`*` for one token, `>` for the remaining tail) — both
// are handled uniformly by eventmatch.Matches.
func (r *WorkflowRegistry) GetByEventType(eventType string) []*types.WorkflowDefinition {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var matched []*types.WorkflowDefinition
	for _, wf := range r.workflows {
		if wf.Trigger == nil || wf.Trigger.Type != "event" {
			continue
		}
		if eventmatch.Matches(wf.Trigger.EventType, eventType) {
			matched = append(matched, wf)
		}
	}
	return matched
}

func (r *WorkflowRegistry) List() []*types.WorkflowDefinition {
	r.mu.RLock()
	defer r.mu.RUnlock()

	workflows := make([]*types.WorkflowDefinition, 0, len(r.workflows))
	for _, wf := range r.workflows {
		workflows = append(workflows, wf)
	}
	return workflows
}

func (r *WorkflowRegistry) Remove(id string) error {
	r.mu.Lock()
	def, ok := r.workflows[id]
	if !ok {
		r.mu.Unlock()
		return fmt.Errorf("workflow not found: %s", id)
	}
	delete(r.workflows, id)
	registrar := r.registrar
	logger := r.logger
	r.mu.Unlock()

	if def.Trigger != nil {
		if err := registrar.Unregister(id, def.Trigger); err != nil && logger != nil {
			logger.Error("triggers: unregister failed", "workflow_id", id, "error", err)
		}
	}
	return nil
}
