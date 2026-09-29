package tasks

import (
	"context"
	"fmt"
	"sync"

	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

type Task interface {
	Execute(ctx *TaskContext) (*types.TaskResult, error)
	Type() string
}

type TaskContext struct {
	// Context is done when the run is cancelled. A task that blocks should
	// return once it is; the engine stops waiting for it either way.
	Context    context.Context
	WorkflowID string
	// ExecutionID identifies this run, as distinct from WorkflowID which
	// identifies the definition. A side effect attributed only to the
	// definition cannot be traced back to the run that produced it, which is
	// the join any "what caused this" question needs. Empty for in-memory
	// test workflows executed outside the engine.
	ExecutionID  string
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
	// WorkflowID and ExecutionID are forwarded from TaskContext so action
	// handlers (e.g. NewAlertAction) can attribute their side effects — to
	// the workflow that defined the step, and to the run that fired it.
	// Empty when unresolved.
	//
	// Every field below is copied by hand in two places, ActionTask.Execute
	// and WithServices. A field added to this struct alone therefore arrives
	// as its zero value for every action, which reads as a data bug rather
	// than the wiring omission it is.
	WorkflowID   string
	ExecutionID  string
	TaskID       string
	TriggerEvent *types.Event
	Logger       Logger
	// Context is done when the run is cancelled; see TaskContext.Context.
	Context context.Context
}

type ActionFunc[TServices any] func(ctx ActionContext[TServices], params map[string]any) (map[string]any, error)

// ParamsValidator checks a step's parameters as written in the workflow
// definition, before any expression is resolved. It must accept a value that
// is still an unresolved `${...}` template: that value is only known when the
// step runs, and the action checks it again then.
type ParamsValidator func(params map[string]any) error

type ActionRegistry[TServices any] struct {
	mu         sync.RWMutex
	actions    map[string]ActionFunc[TServices]
	validators map[string]ParamsValidator
}

func NewActionRegistry[TServices any]() *ActionRegistry[TServices] {
	return &ActionRegistry[TServices]{
		actions:    make(map[string]ActionFunc[TServices]),
		validators: make(map[string]ParamsValidator),
	}
}

// RegisterValidated registers an action whose parameters are checked when a
// workflow using it is registered, so a step that can never succeed is refused
// up front instead of failing on every run.
func (r *ActionRegistry[TServices]) RegisterValidated(name string, action ActionFunc[TServices], validate ParamsValidator) error {
	if validate == nil {
		return fmt.Errorf("action %s: validator is required", name)
	}
	if err := r.Register(name, action); err != nil {
		return err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.validators[name] = validate
	return nil
}

// ValidateParams runs the named action's validator. An action registered
// without one, or not registered at all, passes: an unknown action is reported
// when the step runs, as it always has been.
func (r *ActionRegistry[TServices]) ValidateParams(name string, params map[string]any) error {
	r.mu.RLock()
	validate, ok := r.validators[name]
	r.mu.RUnlock()
	if !ok {
		return nil
	}
	return validate(params)
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
