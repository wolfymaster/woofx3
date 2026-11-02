package services

import (
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/models"
)

// storedTrigger is the part of a workflow's trigger that decides its place
// among the other workflows on its event.
type storedTrigger struct {
	Type  string `json:"type"`
	Event string `json:"event"`
	Order *int   `json:"order"`
}

const eventTriggerType = "event"

// withModuleWorkflowOrder returns triggerJSON holding the order a module's
// workflow runs in among the workflows on its event, so everything listed
// under one trigger runs top to bottom and a failure in one module's steps
// leaves the next module's alone (docs/workflow/execution.md).
//
// A workflow already stored keeps its order: an upgrade must not undo where the
// streamer put it. A new one goes last. Two installs racing can take the same
// order, which the engine resolves by workflow id, so no lock is taken for it.
func withModuleWorkflowOrder(
	triggerJSON string,
	createdByRef string,
	manifestID string,
	stored []*models.WorkflowDefinition,
) (string, error) {
	var trigger storedTrigger
	if err := json.Unmarshal([]byte(triggerJSON), &trigger); err != nil {
		return "", fmt.Errorf("read trigger: %w", err)
	}
	if trigger.Type != eventTriggerType || trigger.Event == "" {
		return triggerJSON, nil
	}

	next := 0
	var kept *int
	for _, row := range stored {
		var other storedTrigger
		// A row with an unreadable trigger has no place in any event's order.
		if err := json.Unmarshal([]byte(row.Trigger), &other); err != nil {
			continue
		}
		if other.Type != eventTriggerType || other.Event != trigger.Event || other.Order == nil {
			continue
		}
		if row.CreatedByType == "MODULE" && row.CreatedByRef == createdByRef && row.ManifestID == manifestID {
			kept = other.Order
		}
		if *other.Order >= next {
			next = *other.Order + 1
		}
	}
	if kept != nil {
		next = *kept
	}

	return withTriggerOrder(triggerJSON, next)
}

// withOwnWorkflowOrder returns triggerJSON holding the order a streamer's
// workflow runs in, so what the Alerts page lists is what happens: their own
// steps run before any module's on the same trigger, and every one of their
// workflows waits its turn. A workflow already in the right place is returned
// as it is. A trigger with fields a merge doesn't know is left alone, because it
// isn't listed under another workflow's trigger.
func withOwnWorkflowOrder(triggerJSON string, stored []*models.WorkflowDefinition, id uuid.UUID) (string, error) {
	identity, ok := triggerIdentity(triggerJSON)
	if !ok {
		return triggerJSON, nil
	}
	var trigger storedTrigger
	if err := json.Unmarshal([]byte(triggerJSON), &trigger); err != nil {
		return "", fmt.Errorf("read trigger: %w", err)
	}

	var lowestModule *int
	next := 0
	for _, row := range stored {
		var other storedTrigger
		// A row with an unreadable trigger has no place in any event's order.
		if row.ID == id || json.Unmarshal([]byte(row.Trigger), &other) != nil {
			continue
		}
		if other.Type != eventTriggerType || other.Event != trigger.Event || other.Order == nil {
			continue
		}
		if *other.Order >= next {
			next = *other.Order + 1
		}
		otherIdentity, ok := triggerIdentity(row.Trigger)
		if row.CreatedByType == "MODULE" && ok && otherIdentity == identity &&
			(lowestModule == nil || *other.Order < *lowestModule) {
			lowestModule = other.Order
		}
	}

	switch {
	case lowestModule != nil && (trigger.Order == nil || *trigger.Order >= *lowestModule):
		return withTriggerOrder(triggerJSON, *lowestModule-1)
	case trigger.Order == nil:
		return withTriggerOrder(triggerJSON, next)
	}
	return triggerJSON, nil
}

func withTriggerOrder(triggerJSON string, order int) (string, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal([]byte(triggerJSON), &fields); err != nil {
		return "", fmt.Errorf("read trigger: %w", err)
	}
	written, err := json.Marshal(order)
	if err != nil {
		return "", fmt.Errorf("write trigger order: %w", err)
	}
	fields["order"] = written
	trigger, err := json.Marshal(fields)
	if err != nil {
		return "", fmt.Errorf("write trigger: %w", err)
	}
	return string(trigger), nil
}
