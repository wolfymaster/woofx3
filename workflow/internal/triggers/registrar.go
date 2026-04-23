// Package triggers owns the bridge between a workflow's declared trigger and
// the machinery that actually fires the workflow (NATS subscriptions for event
// triggers, cron jobs for schedule triggers). It is ref-counted so multiple
// workflows sharing the same trigger subject produce exactly one subscription.
package triggers

import (
	"fmt"

	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// Registrar is the surface every trigger type implements.
//
// Register is called when a workflow becomes active in the engine. Unregister
// is called when it is removed. Both are idempotent: registering the same
// (workflowID, trigger) twice is safe, and unregistering something never
// registered is a no-op.
type Registrar interface {
	Register(workflowID string, trigger *types.TriggerConfig) error
	Unregister(workflowID string, trigger *types.TriggerConfig) error
}

// CompositeRegistrar routes to a type-specific registrar based on trigger.Type.
type CompositeRegistrar struct {
	byType map[string]Registrar
}

func NewCompositeRegistrar() *CompositeRegistrar {
	return &CompositeRegistrar{byType: make(map[string]Registrar)}
}

// Register associates a trigger type with its registrar. Panics on duplicate
// type since that always indicates a wiring bug.
func (c *CompositeRegistrar) Set(triggerType string, r Registrar) {
	if _, exists := c.byType[triggerType]; exists {
		panic(fmt.Sprintf("triggers: duplicate registrar for type %q", triggerType))
	}
	c.byType[triggerType] = r
}

func (c *CompositeRegistrar) Register(workflowID string, trigger *types.TriggerConfig) error {
	if trigger == nil {
		return nil
	}
	r, ok := c.byType[trigger.Type]
	if !ok {
		return fmt.Errorf("triggers: no registrar for type %q", trigger.Type)
	}
	return r.Register(workflowID, trigger)
}

func (c *CompositeRegistrar) Unregister(workflowID string, trigger *types.TriggerConfig) error {
	if trigger == nil {
		return nil
	}
	r, ok := c.byType[trigger.Type]
	if !ok {
		return fmt.Errorf("triggers: no registrar for type %q", trigger.Type)
	}
	return r.Unregister(workflowID, trigger)
}
