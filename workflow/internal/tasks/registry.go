package tasks

import (
	"fmt"
	"sync"

	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

type Task interface {
	Execute(ctx *TaskContext) (*types.TaskResult, error)
	Type() string
}

type TaskContext struct {
	WorkflowID string
	// ApplicationID scopes the executing workflow to a specific
	// application — populated by the engine from the workflow
	// definition before each task runs. Action handlers stamp this
	// onto outbound envelopes (e.g. the `alert` action) so downstream
	// recorders can attribute dispatches without a singleton fallback.
	// Empty string when the engine couldn't resolve it (e.g.
	// in-memory test workflows registered without an application).
	ApplicationID string
	TaskID        string
	TriggerEvent  *types.Event
	Variables     map[string]any
	TaskExports   map[string]map[string]any // task ID -> exports
	Logger        Logger
}

type Logger interface {
	Info(message string, args ...any)
	Warn(message string, args ...any)
	Error(message string, args ...any)
	Debug(message string, args ...any)
}

// TaskFactory builds a Task from its definition plus the resolved runtime
// parameters. Factories receive the full TaskDefinition so each task type can
// read its own top-level config fields (e.g. Action for "action" tasks, Wait
// for "wait" tasks) without smuggling dispatch state through the parameters
// map.
type TaskFactory func(taskDef *types.TaskDefinition, params map[string]any) (Task, error)

type TaskRegistry struct {
	mu        sync.RWMutex
	factories map[string]TaskFactory
}

func NewTaskRegistry() *TaskRegistry {
	return &TaskRegistry{
		factories: make(map[string]TaskFactory),
	}
}

func (r *TaskRegistry) Register(taskType string, factory TaskFactory) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, exists := r.factories[taskType]; exists {
		return fmt.Errorf("task type already registered: %s", taskType)
	}

	r.factories[taskType] = factory
	return nil
}

func (r *TaskRegistry) Create(taskDef *types.TaskDefinition, params map[string]any) (Task, error) {
	r.mu.RLock()
	factory, ok := r.factories[taskDef.Type]
	r.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("unknown task type: %s", taskDef.Type)
	}

	return factory(taskDef, params)
}

func (r *TaskRegistry) List() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()

	types := make([]string, 0, len(r.factories))
	for t := range r.factories {
		types = append(types, t)
	}
	return types
}

type ActionContext[TServices any] struct {
	Services TServices
	// ApplicationID is forwarded from TaskContext so action handlers
	// (e.g. NewAlertAction) can attribute their side effects to the
	// owning application. Empty when unresolved.
	ApplicationID string
	TriggerEvent  *types.Event
}

type ActionFunc[TServices any] func(ctx ActionContext[TServices], params map[string]any) (map[string]any, error)

type ActionRegistry[TServices any] struct {
	mu      sync.RWMutex
	actions map[string]ActionFunc[TServices]
}

func NewActionRegistry[TServices any]() *ActionRegistry[TServices] {
	return &ActionRegistry[TServices]{
		actions: make(map[string]ActionFunc[TServices]),
	}
}

func (r *ActionRegistry[TServices]) Register(name string, action ActionFunc[TServices]) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, exists := r.actions[name]; exists {
		return fmt.Errorf("action already registered: %s", name)
	}

	r.actions[name] = action
	return nil
}

func (r *ActionRegistry[TServices]) Get(name string) (ActionFunc[TServices], error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	action, ok := r.actions[name]
	if !ok {
		return nil, fmt.Errorf("action not found: %s", name)
	}
	return action, nil
}
