package services

import (
	"encoding/json"
	"fmt"

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

	var fields map[string]json.RawMessage
	if err := json.Unmarshal([]byte(triggerJSON), &fields); err != nil {
		return "", fmt.Errorf("read trigger: %w", err)
	}
	order, err := json.Marshal(next)
	if err != nil {
		return "", fmt.Errorf("write trigger order: %w", err)
	}
	fields["order"] = order
	written, err := json.Marshal(fields)
	if err != nil {
		return "", fmt.Errorf("write trigger: %w", err)
	}
	return string(written), nil
}
