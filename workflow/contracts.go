package main

import (
	"encoding/json"
	"fmt"

	"github.com/wolfymaster/woofx3/common/cloudevents"
	"github.com/wolfymaster/woofx3/common/messages/workflow"
)

// wireMessage is what ogen generates for every schema of a message contract.
type wireMessage interface {
	json.Unmarshaler
	Validate() error
}

// checkWire decodes raw into T, which refuses a field the contract does not
// list, and validates the result against the contract's bounds.
func checkWire[T any, P interface {
	*T
	wireMessage
}](raw []byte) error {
	var message T
	if err := P(&message).UnmarshalJSON(raw); err != nil {
		return fmt.Errorf("decode: %w", err)
	}
	if err := P(&message).Validate(); err != nil {
		return fmt.Errorf("validate: %w", err)
	}
	return nil
}

// checkPublished validates an event the engine is about to publish against
// its contract in shared/contracts/workflow, so a producer that drifts fails
// where it publishes rather than in whoever reads the event. An event type
// with no contract passes: those are events a workflow's own actions emit.
func checkPublished(eventType string, raw []byte) error {
	switch cloudevents.Subject(eventType) {
	case cloudevents.SubjectWorkflowRunStarted:
		return checkWire[workflow.WorkflowRunStartedEvent](raw)
	case cloudevents.SubjectWorkflowRunCompleted:
		return checkWire[workflow.WorkflowRunCompletedEvent](raw)
	case cloudevents.SubjectWorkflowRunFailed:
		return checkWire[workflow.WorkflowRunFailedEvent](raw)
	case cloudevents.SubjectWorkflowRunCancelled:
		return checkWire[workflow.WorkflowRunCancelledEvent](raw)
	case cloudevents.SubjectWorkflowHealthSnapshot:
		return checkWire[workflow.WorkflowHealthSnapshotEvent](raw)
	case cloudevents.SubjectWorkflowHealthChanged:
		return checkWire[workflow.WorkflowHealthChangedEvent](raw)
	default:
		return nil
	}
}
