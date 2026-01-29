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
	WorkflowID   string
	TaskID       string
	TriggerEvent *types.Event
	Variables    map[string]any
	TaskExports  map[string]map[string]any // task ID -> exports
	Logger       Logger
}

type Logger interface {
	Info(message string, args ...any)
	Warn(message string, args ...any)
	Error(message string, args ...any)
	Debug(message string, args ...any)
}

type TaskFactory func(params map[string]any) (Task, error)

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

func (r *TaskRegistry) Create(taskType string, params map[string]any) (Task, error) {
	r.mu.RLock()
	factory, ok := r.factories[taskType]
	r.mu.RUnlock()

	if !ok {
		return nil, fmt.Errorf("unknown task type: %s", taskType)
	}

	return factory(params)
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
