package cloudevents

import (
	"fmt"
	"time"

	ce "github.com/cloudevents/sdk-go/v2"
)

const (
	// OperationCreated is the operation value for workflow creation events
	OperationCreated = "created"

	// OperationUpdated is the operation value for workflow update events
	OperationUpdated = "updated"

	// OperationDeleted is the operation value for workflow deletion events
	OperationDeleted = "deleted"

	WorkflowChangeEventSubject = ""
)

// WorkflowChange is a wrapper around ce.Event for workflow change events
type WorkflowChangeEvent struct {
	ce.Event
	subject string
}

type WorkflowChangeData struct {
	Operation string `json:"operation"`
	EntityID  string `json:"entityId"`
}

// Encode encodes the workflow change event to JSON bytes
func (w *WorkflowChangeEvent) Encode() ([]byte, error) {
	return Encode(w)
}

// Decode decodes JSON data into the workflow change event
func (w *WorkflowChangeEvent) Decode(data []byte) error {
	return Decode(data, w)
}

// Data extracts WorkflowChangeData from the workflow change event
// This includes only operation and entity ID from extensions
func (w *WorkflowChangeEvent) Data() (*WorkflowChangeData, error) {
	var parsedWorkflowChangeData WorkflowChangeData
	if err := w.DataAs(&parsedWorkflowChangeData); err != nil {
		return nil, err
	}
	return &parsedWorkflowChangeData, nil
}

// Helper functions for WorkflowChangeData
func (d WorkflowChangeData) IsCreated() bool {
	return d.Operation == OperationCreated
}

func (d WorkflowChangeData) IsUpdated() bool {
	return d.Operation == OperationUpdated
}

func (d WorkflowChangeData) IsDeleted() bool {
	return d.Operation == OperationDeleted
}

func (d WorkflowChangeData) IsCreateOrUpdate() bool {
	return d.IsCreated() || d.IsUpdated()
}

// NewWorkflowChangeEvent creates a new workflow change event
func NewWorkflowChangeEvent(operation, entityID, source string) (*WorkflowChangeEvent, error) {
	// Determine event type based on operation
	eventType := fmt.Sprintf("woofx3.workflow.%s", operation)

	// Create the event using CloudEvents SDK
	evt := ce.NewEvent()
	evt.SetType(eventType)
	evt.SetSource(source)
	evt.SetTime(time.Now())

	data := WorkflowChangeData{
		Operation: operation,
		EntityID:  entityID,
	}

	if err := evt.SetData(ce.ApplicationJSON, data); err != nil {
		return nil, err
	}

	return &WorkflowChangeEvent{Event: evt}, nil
}
