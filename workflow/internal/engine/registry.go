package engine

import (
	"fmt"
	"sync"

	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

type WorkflowRegistry struct {
	mu        sync.RWMutex
	workflows map[string]*types.WorkflowDefinition
}

func NewWorkflowRegistry() *WorkflowRegistry {
	return &WorkflowRegistry{
		workflows: make(map[string]*types.WorkflowDefinition),
	}
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
	defer r.mu.Unlock()

	r.workflows[def.ID] = def
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

func (r *WorkflowRegistry) GetByEventType(eventType string) []*types.WorkflowDefinition {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var matched []*types.WorkflowDefinition
	for _, wf := range r.workflows {
		if wf.Trigger != nil && wf.Trigger.Type == "event" && wf.Trigger.EventType == eventType {
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
	defer r.mu.Unlock()

	if _, ok := r.workflows[id]; !ok {
		return fmt.Errorf("workflow not found: %s", id)
	}
	delete(r.workflows, id)
	return nil
}
