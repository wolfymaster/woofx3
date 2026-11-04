package workflow

import (
	"context"
	"fmt"
)

// PublishEventAction is the publish_event step: it publishes the step's
// payload under the event type the workflow names, which may be an
// expression over the trigger's data.
type PublishEventAction struct {
	bus       Bus
	eventType string
}

func NewPublishEventAction(bus Bus, eventType string) *PublishEventAction {
	return &PublishEventAction{bus: bus, eventType: eventType}
}

func (a *PublishEventAction) Execute(ctx context.Context, in ActionInput) error {
	eventType, err := in.Expr.EvalString(a.eventType)
	if err != nil {
		return fmt.Errorf("evaluate event type: %w", err)
	}
	if eventType == "" {
		return fmt.Errorf("publish_event: event type is empty")
	}
	if err := a.bus.Publish(ctx, eventType, in.Payload); err != nil {
		return fmt.Errorf("publish %s: %w", eventType, err)
	}
	return nil
}
